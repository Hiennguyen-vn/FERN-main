package com.fern.services.sync.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.DeviceTokenRegistry;
import com.fern.common.spring.auth.JwtClaims;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.test.TestUserContext;
import com.fern.services.sync.apply.SyncConflictPolicy;
import com.fern.services.sync.apply.SyncPayloadRouter;
import com.fern.services.sync.apply.handlers.MenuSyncPayloadHandler;
import com.fern.services.sync.apply.handlers.PricePolicySyncPayloadHandler;
import com.fern.services.sync.apply.handlers.ProductSyncPayloadHandler;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.hub.RegionalHubNodeScopePolicy;
import com.fern.services.sync.hub.feed.RegionalHubFeedUseCases;
import com.fern.services.sync.hub.forwarding.DownstreamFanoutPlanner;
import com.fern.services.sync.hub.forwarding.RegionalCentralForwardingUseCase;
import com.fern.services.sync.hub.ingest.RegionalHubIngestUseCases;
import com.fern.services.sync.hub.RegionalHubNodeLifecycleUseCases;
import com.fern.services.sync.hub.relay.RegionalIngestRelayEnqueuer;
import com.fern.services.sync.hub.relay.RegionalUpstreamRelayUseCase;
import com.fern.services.sync.hub.status.RegionalHubStatusUseCases;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.model.TargetScope;
import com.fern.services.sync.state.DatabaseDownstreamStateStore;
import com.fern.services.sync.state.DatabaseRegionalRelayStateStore;
import com.fern.services.sync.state.DatabaseSyncStateStore;
import com.fern.services.sync.state.SyncRepository;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class SyncServiceIntegrationTest {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T05:00:00Z"), ZoneOffset.UTC);

  private static DataSource dataSource;

  private SyncRepository repository;

  @BeforeAll
  static void seedBaseline() {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
  }

  @BeforeEach
  void setUp() throws Exception {
    repository = new SyncRepository(dataSource, OBJECT_MAPPER, CLOCK);
    truncateSyncTables();
    insertSyncNode("region-1", 20L, "HCM-REGION-HUB", null, "REGIONAL_HUB");
    insertSyncNode("node-10", 10L, "HCM-D1-EDGE", "region-1", "OUTLET_EDGE");
    insertSyncNode("node-11", 11L, "HCM-D2-EDGE", "region-1", "OUTLET_EDGE");
  }

  @Test
  void uploadIsIdempotentAgainstRealPostgresSchema() throws Exception {
    SyncUploadService uploadService = new SyncUploadService(repository, new SyncNodeAuthService(repository));
    SyncDtos.SyncUploadRequest request = new SyncDtos.SyncUploadRequest(
        "node-10",
        10L,
        List.of(event("sale-event-1", 10L)));

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncUploadResponse first = uploadService.upload(request);
      SyncDtos.SyncUploadResponse second = uploadService.upload(request);

      assertEquals(List.of("sale-event-1"), first.accepted());
      assertEquals(List.of("sale-event-1"), second.duplicated());
    }

    assertEquals(1L, countRows("core.central_inbox"));
  }

  @Test
  void downloadOnlyReturnsGlobalAndStoreScopedEvents() throws Exception {
    repository.appendCentralOutbox(
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "product-1",
        json("{\"name\":\"Latte\"}"),
        TargetScope.ALL_STORES,
        null,
        null,
        1L);
    repository.appendCentralOutbox(
        EventType.PRICE_POLICY_UPDATED,
        AggregateType.PRICE_POLICY,
        "price-10",
        json("{\"storeId\":10,\"unitPrice\":59000}"),
        TargetScope.STORE,
        10L,
        null,
        12L);
    repository.appendCentralOutbox(
        EventType.PRICE_POLICY_UPDATED,
        AggregateType.PRICE_POLICY,
        "price-11",
        json("{\"storeId\":11,\"unitPrice\":61000}"),
        TargetScope.STORE,
        11L,
        null,
        13L);

    SyncDownloadService downloadService = new SyncDownloadService(
        repository,
        new SyncNodeAuthService(repository),
        new SyncProperties());

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncDownloadResponse response = downloadService.download(10L, "0", 10);

      assertEquals(2, response.events().size());
      assertTrue(response.events().stream().anyMatch(event -> event.aggregateId().equals("product-1")));
      assertTrue(response.events().stream().anyMatch(event -> event.aggregateId().equals("price-10")));
      assertFalse(response.events().stream().anyMatch(event -> event.aggregateId().equals("price-11")));
      assertTrue(response.events().stream().anyMatch(event -> "ALL_STORES".equals(event.targetScope())));
      assertTrue(response.events().stream().anyMatch(event -> "STORE".equals(event.targetScope()) && Long.valueOf(10L).equals(event.targetStoreId())));
    }
  }

  @Test
  void ackAndStatusUseMigratedTables() throws Exception {
    SyncInboxService inboxService = new SyncInboxService(repository, new SyncNodeAuthService(repository));
    SyncStatusService statusService = new SyncStatusService(repository, new SyncNodeAuthService(repository));
    repository.appendCentralOutbox(
        EventType.PRICE_POLICY_UPDATED,
        AggregateType.PRICE_POLICY,
        "price-10",
        json("{\"storeId\":10,\"unitPrice\":59000}"),
        TargetScope.STORE,
        10L,
        null,
        12L);

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      inboxService.ack(new SyncDtos.SyncAckRequest(
          "node-10",
          10L,
          List.of(new SyncDtos.SyncAckItem("1", SyncStatus.APPLIED, null))));

      SyncDtos.SyncStatusResponse status = statusService.status(10L);

      assertEquals(10L, status.storeId());
      assertEquals(1L, status.pendingDownloadCount());
      assertEquals(0L, status.failedEventCount());
    }
  }

  @Test
  void regionalHubUploadUsesDownstreamInboxAndIsIdempotent() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    DatabaseRegionalRelayStateStore relayStateStore = new DatabaseRegionalRelayStateStore(repository);
    RegionalHubIngestUseCases ingestUseCases = new RegionalHubIngestUseCases(
        downstreamStore,
        new RegionalHubNodeScopePolicy(downstreamStore, properties),
        new RegionalIngestRelayEnqueuer(relayStateStore));

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncUploadRequest request = new SyncDtos.SyncUploadRequest(
          "node-10",
          10L,
          List.of(event("hub-sale-1", 10L)));

      SyncDtos.SyncUploadResponse first = ingestUseCases.upload(request);
      SyncDtos.SyncUploadResponse second = ingestUseCases.upload(request);

      assertEquals(List.of("hub-sale-1"), first.accepted());
      assertEquals(List.of("hub-sale-1"), second.duplicated());
    }

    assertEquals(1L, countRows("core.downstream_inbox"));
  }

  @Test
  void regionalHubDownloadAndAckUseDownstreamTables() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    DatabaseSyncStateStore syncStateStore = new DatabaseSyncStateStore(repository);
    RegionalHubFeedUseCases feedUseCases = new RegionalHubFeedUseCases(
        downstreamStore,
        syncStateStore,
        new RegionalHubNodeScopePolicy(downstreamStore, properties));

    repository.appendDownstreamEvent(
        "region-1",
        EventType.PRODUCT_UPDATED.name(),
        AggregateType.PRODUCT.name(),
        "product-1",
        TargetScope.ALL_STORES.name(),
        null,
        null,
        null,
        json("{\"name\":\"Latte\"}"),
        1L);
    repository.appendDownstreamEvent(
        "region-1",
        EventType.PRICE_POLICY_UPDATED.name(),
        AggregateType.PRICE_POLICY.name(),
        "price-10",
        TargetScope.STORE.name(),
        10L,
        null,
        null,
        json("{\"storeId\":10,\"unitPrice\":59000}"),
        2L);
    repository.appendDownstreamEvent(
        "region-1",
        EventType.PRICE_POLICY_UPDATED.name(),
        AggregateType.PRICE_POLICY.name(),
        "price-11",
        TargetScope.STORE.name(),
        11L,
        null,
        null,
        json("{\"storeId\":11,\"unitPrice\":61000}"),
        3L);

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncDownloadResponse response = feedUseCases.download("node-10", 10L, "0", 10);

      assertEquals(2, response.events().size());
      assertTrue(response.events().stream().anyMatch(event -> event.aggregateId().equals("product-1")));
      assertTrue(response.events().stream().anyMatch(event -> event.aggregateId().equals("price-10")));
      assertFalse(response.events().stream().anyMatch(event -> event.aggregateId().equals("price-11")));

      feedUseCases.ack(new SyncDtos.SyncAckRequest(
          "node-10",
          10L,
          List.of(new SyncDtos.SyncAckItem(response.events().getFirst().eventId(), SyncStatus.APPLIED, null))));

      assertEquals(response.nextCursor(),
          singleText("SELECT last_cursor FROM core.sync_offsets WHERE node_id = 'node-10' AND stream_name = 'downstream-outbox'"));
    }

    assertEquals(1L, countRows("core.downstream_event_acks"));
  }

  @Test
  void regionalHubStatusReadsDownstreamState() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    RegionalHubStatusUseCases statusUseCases = new RegionalHubStatusUseCases(
        repository,
        new RegionalHubNodeScopePolicy(downstreamStore, properties));

    repository.insertDownstreamInbox("node-10", 10L, event("hub-sale-2", 10L));
    repository.appendDownstreamEvent(
        "region-1",
        EventType.PRODUCT_UPDATED.name(),
        AggregateType.PRODUCT.name(),
        "product-2",
        TargetScope.STORE.name(),
        10L,
        null,
        null,
        json("{\"name\":\"Mocha\"}"),
        2L);

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncStatusResponse status = statusUseCases.status("node-10", 10L);

      assertEquals(10L, status.storeId());
      assertEquals(1L, status.pendingUploadCount());
      assertEquals(1L, status.pendingDownloadCount());
      assertEquals(0L, status.pendingRelayCount());
      assertEquals(0L, status.failedRelayCount());
    }
  }

  @Test
  void regionalRelayMovesAcceptedHubIngestIntoCentralInbox() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    DatabaseRegionalRelayStateStore relayStateStore = new DatabaseRegionalRelayStateStore(repository);
    DatabaseSyncStateStore syncStateStore = new DatabaseSyncStateStore(repository);
    RegionalHubIngestUseCases ingestUseCases = new RegionalHubIngestUseCases(
        downstreamStore,
        new RegionalHubNodeScopePolicy(downstreamStore, properties),
        new RegionalIngestRelayEnqueuer(relayStateStore));
    RegionalUpstreamRelayUseCase relayUseCase = new RegionalUpstreamRelayUseCase(
        relayStateStore,
        new com.fern.services.sync.shared.SyncTransportClient() {
          @Override
          public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
            for (SyncDtos.SyncEvent event : request.events()) {
              repository.insertCentralInbox(request.nodeId(), request.storeId(), event);
            }
            return new SyncDtos.SyncUploadResponse(
                request.events().stream().map(SyncDtos.SyncEvent::eventId).toList(),
                List.of(),
                List.of());
          }

          @Override
          public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
            throw new UnsupportedOperationException();
          }

          @Override
          public void ack(SyncDtos.SyncAckRequest request) {
          }
        },
        new com.fern.services.sync.tier.SyncTierProfileRegistry(
            List.of(
                new com.fern.services.sync.tier.outlet.OutletTierProfile(),
                new com.fern.services.sync.tier.regional.RegionalTierProfile(),
                new com.fern.services.sync.tier.master.MasterTierProfile()),
            properties),
        syncStateStore,
        properties);

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncUploadResponse response = ingestUseCases.upload(new SyncDtos.SyncUploadRequest(
          "node-10",
          10L,
          List.of(event("relay-sale-1", 10L))));
      assertEquals(List.of("relay-sale-1"), response.accepted());
    }

    assertEquals("PENDING", singleText("SELECT status FROM core.downstream_inbox WHERE event_id = 'relay-sale-1'"));

    try (AutoCloseable ignored = TestUserContext.internalServiceScope("sync-service")) {
      int relayed = relayUseCase.relayToCentral();
      assertEquals(1, relayed);
    }

    assertEquals("APPLIED", singleText("SELECT status FROM core.downstream_inbox WHERE event_id = 'relay-sale-1'"));
    assertEquals(1L, countRows("core.central_inbox"));
    assertEquals("node-10", singleText("SELECT source_node_id FROM core.central_inbox WHERE event_id = 'relay-sale-1'"));

    RegionalHubStatusUseCases statusUseCases = new RegionalHubStatusUseCases(
        repository,
        new RegionalHubNodeScopePolicy(downstreamStore, properties));
    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncStatusResponse status = statusUseCases.status("node-10", 10L);
      assertEquals(0L, status.pendingRelayCount());
      assertEquals(0L, status.failedRelayCount());
      assertEquals(CLOCK.instant(), status.lastRelayAttemptAt());
      assertEquals(CLOCK.instant(), status.lastRelaySuccessAt());
    }
  }

  @Test
  void regionalForwardingMovesCentralFeedIntoDownstreamOutboxForManagedOutlet() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    DatabaseSyncStateStore syncStateStore = new DatabaseSyncStateStore(repository);
    RegionalCentralForwardingUseCase forwardingUseCase = new RegionalCentralForwardingUseCase(
        new com.fern.services.sync.shared.SyncTransportClient() {
          @Override
          public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
            throw new UnsupportedOperationException();
          }

          @Override
          public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
            return new SyncDtos.SyncDownloadResponse(List.of(
                new SyncDtos.SyncDownloadEvent(
                    "1",
                    EventType.PRODUCT_UPDATED,
                    AggregateType.PRODUCT,
                    "product-forward-1",
                    5L,
                    CLOCK.instant(),
                    json("{\"name\":\"Forwarded Latte\"}"),
                    "STORE",
                    10L,
                    null)), "1", false);
          }

          @Override
          public void ack(SyncDtos.SyncAckRequest request) {
          }
        },
        syncStateStore,
        downstreamStore,
        new DownstreamFanoutPlanner(downstreamStore, properties),
        new com.fern.services.sync.tier.SyncTierProfileRegistry(
            List.of(
                new com.fern.services.sync.tier.outlet.OutletTierProfile(),
                new com.fern.services.sync.tier.regional.RegionalTierProfile(),
                new com.fern.services.sync.tier.master.MasterTierProfile()),
            properties),
        properties);
    RegionalHubFeedUseCases feedUseCases = new RegionalHubFeedUseCases(
        downstreamStore,
        syncStateStore,
        new RegionalHubNodeScopePolicy(downstreamStore, properties));

    repository.appendCentralOutbox(
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "unused-central-row",
        json("{\"name\":\"Unused\"}"),
        TargetScope.STORE,
        10L,
        null,
        5L);

    try (AutoCloseable ignored = TestUserContext.internalServiceScope("sync-service")) {
      int forwarded = forwardingUseCase.forwardFromCentral();
      assertEquals(1, forwarded);
    }

    try (AutoCloseable ignored = TestUserContext.deviceScope(9001L, 10L)) {
      SyncDtos.SyncDownloadResponse response = feedUseCases.download("node-10", 10L, "0", 10);
      assertEquals(1, response.events().size());
      assertEquals("product-forward-1", response.events().getFirst().aggregateId());
      assertEquals("NODE", response.events().getFirst().targetScope());
    }
  }

  @Test
  void storePayloadRouterAppliesProductPriceAndMenuWithVersionGate() throws Exception {
    SyncConflictPolicy applyService = new SyncConflictPolicy(repository);
    SyncPayloadRouter router = new SyncPayloadRouter(
        List.of(
            new ProductSyncPayloadHandler(dataSource, CLOCK),
            new PricePolicySyncPayloadHandler(dataSource, CLOCK),
            new MenuSyncPayloadHandler(dataSource, CLOCK)
        ),
        applyService,
        repository);

    boolean productApplied = router.apply(new SyncDtos.SyncEvent(
        "product-event-1",
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "9001",
        3L,
        CLOCK.instant(),
        json("""
            {
              "productId": 9001,
              "code": "LATTE",
              "name": "Latte",
              "categoryCode": "coffee",
              "categoryName": "Coffee",
              "status": "active"
            }
            """)));
    boolean priceApplied = router.apply(new SyncDtos.SyncEvent(
        "price-event-1",
        EventType.PRICE_POLICY_UPDATED,
        AggregateType.PRICE_POLICY,
        "9001-10",
        4L,
        CLOCK.instant(),
        json("""
            {
              "productId": 9001,
              "storeId": 10,
              "currencyCode": "USD",
              "priceValue": 59000,
              "effectiveFrom": "2026-06-24"
            }
            """)));
    boolean menuApplied = router.apply(new SyncDtos.SyncEvent(
        "menu-event-1",
        EventType.MENU_UPDATED,
        AggregateType.MENU,
        "7001",
        2L,
        CLOCK.instant(),
        json("""
            {
              "menuId": 7001,
              "code": "HCM-DAY",
              "name": "HCM Day Menu",
              "status": "active",
              "scopeType": "outlet",
              "scopeId": 10,
              "categories": [
                {
                  "categoryId": 7101,
                  "code": "COFFEE",
                  "name": "Coffee",
                  "displayOrder": 1,
                  "items": [
                    {
                      "menuItemId": 7201,
                      "productId": 9001,
                      "displayOrder": 1,
                      "active": true
                    }
                  ]
                }
              ]
            }
            """)));

    assertTrue(productApplied);
    assertTrue(priceApplied);
    assertTrue(menuApplied);
    assertEquals("Latte", singleText("SELECT name FROM core.product WHERE id = 9001"));
    assertEquals("59000.00", singleText("SELECT price_value::text FROM core.product_price WHERE product_id = 9001 AND outlet_id = 10"));
    assertEquals("HCM Day Menu", singleText("SELECT name FROM core.menu WHERE id = 7001"));
    assertEquals("Coffee", singleText("SELECT name FROM core.menu_category WHERE id = 7101"));
    assertEquals("9001", singleText("SELECT product_id::text FROM core.menu_item WHERE id = 7201"));

    boolean staleProductApplied = router.apply(new SyncDtos.SyncEvent(
        "product-event-stale",
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "9001",
        2L,
        CLOCK.instant(),
        json("""
            {
              "productId": 9001,
              "code": "LATTE",
              "name": "Old Latte",
              "categoryCode": "coffee",
              "status": "active"
            }
            """)));

    assertFalse(staleProductApplied);
    assertEquals("Latte", singleText("SELECT name FROM core.product WHERE id = 9001"));
  }

  @Test
  void commonSyncWritersPersistStructuredCentralAndLocalPayloads() throws Exception {
    repository.appendCentralOutbox(
        EventType.PRODUCT_CREATED,
        AggregateType.PRODUCT,
        "9101",
        json("""
            {
              "productId": 9101,
              "code": "ESP",
              "name": "Espresso",
              "categoryCode": "coffee",
              "status": "active",
              "deleted": false,
              "version": 1,
              "updatedAt": "2026-06-24T05:00:00Z"
            }
            """),
        TargetScope.ALL_STORES,
        null,
        null,
        1L);
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             INSERT INTO core.sync_outbox (
               id, event_type, aggregate_type, aggregate_id, payload_json, status, retry_count
             ) VALUES (?, ?, ?, ?, ?::jsonb, 'PENDING', 0)
             ON CONFLICT (id) DO NOTHING
             """
         )) {
      ps.setString(1, "SALE_ORDER_CREATED:9901");
      ps.setString(2, "SALE_ORDER_CREATED");
      ps.setString(3, "SALE_ORDER");
      ps.setString(4, "9901");
      ps.setString(5, OBJECT_MAPPER.writeValueAsString(json("""
          {
            "saleId": 9901,
            "storeId": 10,
            "currencyCode": "USD",
            "orderType": "dine_in",
            "status": "order_created",
            "paymentStatus": "unpaid",
            "subtotal": 59000.00,
            "discount": 0,
            "taxAmount": 0,
            "totalAmount": 59000.00,
            "items": [],
            "createdAt": "2026-06-24T05:00:00Z"
          }
          """)));
      ps.executeUpdate();
    }

    assertEquals("PRODUCT_CREATED", singleText("SELECT event_type FROM core.central_outbox WHERE aggregate_id = '9101'"));
    assertEquals("Espresso", singleText("SELECT payload_json ->> 'name' FROM core.central_outbox WHERE aggregate_id = '9101'"));
    assertEquals("SALE_ORDER_CREATED", singleText("SELECT event_type FROM core.sync_outbox WHERE id = 'SALE_ORDER_CREATED:9901'"));
  }

  @Test
  void provisioningAndHandshakeRegisterDeviceJwtForSyncNode() throws Exception {
    JwtTokenService jwtTokenService = new JwtTokenService(OBJECT_MAPPER, "sync-test-secret-with-at-least-32-bytes");
    SyncNodeProvisioningService provisioningService = new SyncNodeProvisioningService(
        repository,
        new com.fern.common.utils.services.id.SnowflakeIdGenerator(44),
        jwtTokenService,
        CLOCK,
        3600L);

    SyncDtos.ProvisionSyncNodeResponse provisioned = provisioningService.provision(
        new SyncDtos.ProvisionSyncNodeRequest(
            10L,
            "HCM-D1-SYNC",
            "HCM D1 Store Sync Agent",
            "STORE_EDGE",
            321,
            "hardware-fingerprint",
            null));

    SyncDtos.SyncHandshakeResponse handshake = provisioningService.handshake(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, provisioned.clientSecret()));

    assertEquals(provisioned.nodeId(), handshake.nodeId());
    assertEquals(10L, handshake.storeId());
    assertEquals(provisioned.deviceId(), handshake.deviceId());

    JwtClaims claims = jwtTokenService.verify(handshake.accessToken());
    assertTrue(claims.isDeviceToken());
    assertEquals(provisioned.deviceId(), claims.deviceId());
    assertEquals(10L, claims.deviceOutletId());
    new DeviceTokenRegistry(dataSource, CLOCK).requireActiveDevice(claims, handshake.accessToken());

    SyncDtos.RotateSyncNodeSecretResponse rotated = provisioningService.rotateSecret(provisioned.nodeId());
    assertEquals(provisioned.nodeId(), rotated.nodeId());
    assertThrows(ServiceException.class, () -> provisioningService.handshake(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, provisioned.clientSecret())));

    SyncDtos.SyncHandshakeResponse rotatedHandshake = provisioningService.handshake(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, rotated.clientSecret()));
    assertEquals(rotated.deviceId(), rotatedHandshake.deviceId());

    provisioningService.revoke(provisioned.nodeId());
    assertThrows(ServiceException.class, () -> provisioningService.handshake(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, rotated.clientSecret())));
  }

  @Test
  void regionalHubLifecycleProvisionHandshakeRotateRevokeOnlyForManagedChildren() throws Exception {
    JwtTokenService jwtTokenService = new JwtTokenService(OBJECT_MAPPER, "sync-test-secret-with-at-least-32-bytes");
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    SyncNodeProvisioningService provisioningService = new SyncNodeProvisioningService(
        repository,
        new com.fern.common.utils.services.id.SnowflakeIdGenerator(45),
        jwtTokenService,
        CLOCK,
        3600L);
    RegionalHubNodeLifecycleUseCases lifecycleUseCases = new RegionalHubNodeLifecycleUseCases(
        provisioningService,
        downstreamStore,
        downstreamStore,
        repository,
        properties);

    SyncDtos.ProvisionSyncNodeResponse provisioned = lifecycleUseCases.provisionManagedNode(
        new SyncDtos.ProvisionSyncNodeRequest(
            10L,
            "HCM-D1-HUB-PROVISIONED",
            "HCM D1 Hub Managed Node",
            "STORE_EDGE",
            321,
            "hardware-fingerprint",
            null));

    assertEquals("region-1", singleText("SELECT parent_node_id FROM core.sync_nodes WHERE id = '" + provisioned.nodeId() + "'"));
    assertEquals("OUTLET_EDGE", singleText("SELECT runtime_role FROM core.sync_nodes WHERE id = '" + provisioned.nodeId() + "'"));

    SyncDtos.SyncHandshakeResponse handshake = lifecycleUseCases.handshakeManagedNode(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, provisioned.clientSecret()));
    assertEquals(provisioned.nodeId(), handshake.nodeId());

    SyncDtos.RotateSyncNodeSecretResponse rotated = lifecycleUseCases.rotateManagedNodeSecret(provisioned.nodeId());
    assertThrows(ServiceException.class, () -> lifecycleUseCases.handshakeManagedNode(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, provisioned.clientSecret())));
    assertEquals(rotated.nodeId(), lifecycleUseCases.handshakeManagedNode(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, rotated.clientSecret())).nodeId());

    lifecycleUseCases.revokeManagedNode(provisioned.nodeId());
    assertThrows(ServiceException.class, () -> lifecycleUseCases.handshakeManagedNode(
        new SyncDtos.SyncHandshakeRequest(provisioned.nodeId(), 10L, rotated.clientSecret())));

    assertThrows(ServiceException.class, () -> lifecycleUseCases.provisionManagedNode(
        new SyncDtos.ProvisionSyncNodeRequest(
            10L,
            "HCM-D1-HUB-BADTYPE",
            "Invalid Managed Node",
            "CENTRAL",
            322,
            "hardware-fingerprint",
            null)));
  }

  @Test
  void regionalHubPublishCreatesManagedDownstreamFeedRows() throws Exception {
    SyncProperties properties = hubProperties();
    DatabaseDownstreamStateStore downstreamStore = new DatabaseDownstreamStateStore(repository);
    RegionalHubNodeLifecycleUseCases lifecycleUseCases = new RegionalHubNodeLifecycleUseCases(
        new SyncNodeProvisioningService(
            repository,
            new com.fern.common.utils.services.id.SnowflakeIdGenerator(46),
            new JwtTokenService(OBJECT_MAPPER, "sync-test-secret-with-at-least-32-bytes"),
            CLOCK,
            3600L),
        downstreamStore,
        downstreamStore,
        repository,
        properties);

    long eventId = lifecycleUseCases.publishForManagedChildren(new SyncDtos.CentralOutboxPublishRequest(
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "hub-product-1",
        json("{\"name\":\"Hub Latte\"}"),
        10L,
        null,
        7L));

    assertTrue(eventId > 0);
    assertEquals(1L, countRows("core.downstream_outbox"));
    assertEquals("node-10", singleText("SELECT target_node_id FROM core.downstream_outbox WHERE aggregate_id = 'hub-product-1'"));
    assertEquals("NODE", singleText("SELECT target_scope FROM core.downstream_outbox WHERE aggregate_id = 'hub-product-1'"));
  }

  private SyncDtos.SyncEvent event(String eventId, long storeId) {
    return new SyncDtos.SyncEvent(
        eventId,
        EventType.SALE_ORDER_CREATED,
        AggregateType.SALE_ORDER,
        "sale-1001",
        1L,
        CLOCK.instant(),
        json("{\"storeId\":" + storeId + ",\"totalAmount\":79000}"));
  }

  private JsonNode json(String raw) {
    try {
      return OBJECT_MAPPER.readTree(raw);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  private void truncateSyncTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("TRUNCATE TABLE core.downstream_event_acks CASCADE");
      st.execute("TRUNCATE TABLE core.downstream_inbox CASCADE");
      st.execute("TRUNCATE TABLE core.downstream_outbox CASCADE");
      st.execute("TRUNCATE TABLE core.sync_offsets CASCADE");
      st.execute("TRUNCATE TABLE core.sync_event_acks CASCADE");
      st.execute("TRUNCATE TABLE core.central_inbox CASCADE");
      st.execute("TRUNCATE TABLE core.central_outbox CASCADE");
      st.execute("TRUNCATE TABLE core.sync_nodes CASCADE");
      st.execute("TRUNCATE TABLE core.sync_outbox CASCADE");
      st.execute("TRUNCATE TABLE core.sync_inbox CASCADE");
      st.execute("TRUNCATE TABLE core.local_node_config CASCADE");
      st.execute("TRUNCATE TABLE core.local_applied_versions CASCADE");
      st.execute("TRUNCATE TABLE core.device_registry CASCADE");
    }
  }

  private void insertSyncNode(String nodeId, long storeId, String nodeCode, String parentNodeId, String runtimeRole) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             INSERT INTO core.sync_nodes (id, store_id, node_code, node_name, node_type, status, parent_node_id, runtime_role)
             VALUES (?, ?, ?, ?, 'STORE_EDGE', 'ACTIVE', ?, ?)
             """
         )) {
      ps.setString(1, nodeId);
      ps.setLong(2, storeId);
      ps.setString(3, nodeCode);
      ps.setString(4, nodeCode);
      ps.setString(5, parentNodeId);
      ps.setString(6, runtimeRole);
      ps.executeUpdate();
    }
  }

  private SyncProperties hubProperties() {
    SyncProperties properties = new SyncProperties();
    properties.setTier(com.fern.services.sync.shared.SyncTier.REGIONAL);
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    return properties;
  }

  private long countRows(String table) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement();
         var rs = st.executeQuery("SELECT COUNT(*) FROM " + table)) {
      rs.next();
      return rs.getLong(1);
    }
  }

  private String singleText(String sql) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement();
         var rs = st.executeQuery(sql)) {
      rs.next();
      return rs.getString(1);
    }
  }
}
