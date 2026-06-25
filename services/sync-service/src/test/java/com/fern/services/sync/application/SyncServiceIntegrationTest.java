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
import com.fern.common.sync.CentralSyncOutboxWriter;
import com.fern.common.sync.LocalSyncOutboxWriter;
import com.fern.common.sync.SyncPayloadSchemas;
import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.test.TestUserContext;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import com.fern.services.sync.infrastructure.MenuSyncPayloadHandler;
import com.fern.services.sync.infrastructure.PricePolicySyncPayloadHandler;
import com.fern.services.sync.infrastructure.ProductSyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.model.TargetScope;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
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
    insertSyncNode("node-10", 10L, "HCM-D1-EDGE");
    insertSyncNode("node-11", 11L, "HCM-D2-EDGE");
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
  void storePayloadRouterAppliesProductPriceAndMenuWithVersionGate() throws Exception {
    SyncApplyService applyService = new SyncApplyService(repository);
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
    CentralSyncOutboxWriter centralWriter = new CentralSyncOutboxWriter(OBJECT_MAPPER);
    LocalSyncOutboxWriter localWriter = new LocalSyncOutboxWriter(OBJECT_MAPPER);
    try (Connection conn = dataSource.getConnection()) {
      conn.setAutoCommit(false);
      long version = centralWriter.nextVersion(conn, "PRODUCT", "9101");
      centralWriter.append(
          conn,
          "PRODUCT_CREATED",
          "PRODUCT",
          "9101",
          "ALL_STORES",
          null,
          null,
          new SyncPayloadSchemas.ProductPayload(
              9101L,
              "ESP",
              "Espresso",
              "coffee",
              "active",
              null,
              null,
              false,
              version,
              CLOCK.instant()),
          version);
      localWriter.append(
          conn,
          "SALE_ORDER_CREATED:9901",
          "SALE_ORDER_CREATED",
          "SALE_ORDER",
          "9901",
          new SyncPayloadSchemas.SaleOrderPayload(
              9901L,
              10L,
              null,
              null,
              "USD",
              "dine_in",
              "order_created",
              "unpaid",
              new BigDecimal("59000.00"),
              BigDecimal.ZERO,
              BigDecimal.ZERO,
              new BigDecimal("59000.00"),
              null,
              List.of(),
              CLOCK.instant()));
      conn.commit();
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

  private void insertSyncNode(String nodeId, long storeId, String nodeCode) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             INSERT INTO core.sync_nodes (id, store_id, node_code, node_name, node_type, status)
             VALUES (?, ?, ?, ?, 'STORE_EDGE', 'ACTIVE')
             """
         )) {
      ps.setString(1, nodeId);
      ps.setLong(2, storeId);
      ps.setString(3, nodeCode);
      ps.setString(4, nodeCode);
      ps.executeUpdate();
    }
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
