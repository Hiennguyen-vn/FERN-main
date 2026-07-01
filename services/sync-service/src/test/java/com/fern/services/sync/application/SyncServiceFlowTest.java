package com.fern.services.sync.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import com.fern.services.sync.apply.SyncPayloadHandler;
import com.fern.services.sync.apply.SyncPayloadRouter;
import com.fern.services.sync.apply.SyncEventApplier;
import com.fern.services.sync.apply.SyncConflictPolicy;
import com.fern.services.sync.api.SyncController;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.central.CentralSyncFacade;
import com.fern.services.sync.edge.TieredSyncFacade;
import com.fern.services.sync.hub.RegionalHubNodeScopePolicy;
import com.fern.services.sync.hub.feed.RegionalHubFeedUseCases;
import com.fern.services.sync.hub.forwarding.DownstreamFanoutPlanner;
import com.fern.services.sync.hub.forwarding.RegionalCentralForwardingUseCase;
import com.fern.services.sync.hub.ingest.RegionalHubIngestUseCases;
import com.fern.services.sync.hub.relay.RegionalIngestRelayEnqueuer;
import com.fern.services.sync.hub.relay.RegionalUpstreamRelayUseCase;
import com.fern.services.sync.hub.status.RegionalHubStatusUseCases;
import com.fern.services.sync.hub.RegionalHubFacade;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncDirection;
import com.fern.services.sync.model.SyncStatus;
import com.fern.services.sync.orchestration.TieredSyncOrchestrator;
import com.fern.services.sync.shared.SyncRuntimeMode;
import com.fern.services.sync.shared.SyncRuntimeRoleResolver;
import com.fern.services.sync.shared.SyncTransportClient;
import com.fern.services.sync.shared.SyncTier;
import com.fern.services.sync.state.DownstreamFeedStore;
import com.fern.services.sync.state.DownstreamInboxStore;
import com.fern.services.sync.state.NodeTopologyStore;
import com.fern.services.sync.state.RegionalRelayStateStore;
import com.fern.services.sync.state.DatabaseSyncStateStore;
import com.fern.services.sync.state.SyncRepository.HubOverviewRow;
import com.fern.services.sync.state.SyncRepository;
import com.fern.services.sync.state.SyncRepository.UploadInsertResult;
import com.fern.services.sync.state.SyncStateStore;
import com.fern.services.sync.tier.SyncTierProfileRegistry;
import com.fern.services.sync.tier.outlet.OutletTierProfile;
import com.fern.services.sync.tier.regional.RegionalTierProfile;
import com.fern.services.sync.tier.master.MasterTierProfile;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class SyncServiceFlowTest {

  private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
  private final Clock clock = Clock.fixed(Instant.parse("2026-06-24T04:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void uploadAcceptsStoreOwnedEvent() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncNodeAuthService authService = mock(SyncNodeAuthService.class);
    SyncUploadService service = new SyncUploadService(repository, authService);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("order-1", 10L));
    when(repository.insertCentralInbox("node-10", 10L, request.events().getFirst()))
        .thenReturn(UploadInsertResult.ACCEPTED);

    SyncDtos.SyncUploadResponse response = service.upload(request);

    assertEquals(List.of("order-1"), response.accepted());
    assertEquals(List.of(), response.duplicated());
    assertEquals(List.of(), response.rejected());
    verify(authService).requireUploadScope(request);
  }

  @Test
  void uploadDuplicateEventIdDoesNotCreateDuplicateInboxRow() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncNodeAuthService authService = mock(SyncNodeAuthService.class);
    SyncUploadService service = new SyncUploadService(repository, authService);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("order-1", 10L));
    when(repository.insertCentralInbox("node-10", 10L, request.events().getFirst()))
        .thenReturn(UploadInsertResult.DUPLICATED);

    SyncDtos.SyncUploadResponse response = service.upload(request);

    assertEquals(List.of(), response.accepted());
    assertEquals(List.of("order-1"), response.duplicated());
    assertEquals(List.of(), response.rejected());
  }

  @Test
  void storeCannotUploadAnotherStorePayload() {
    RequestUserContextHolder.set(deviceContext(101L, 10L));
    SyncRepository repository = mock(SyncRepository.class);
    SyncNodeAuthService authService = new SyncNodeAuthService(repository);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("order-1", 11L));

    ServiceException exception = assertThrows(ServiceException.class, () -> authService.requireUploadScope(request));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void downloadReturnsOnlyScopedCentralEventsAndCursor() {
    RequestUserContextHolder.set(deviceContext(101L, 10L));
    SyncRepository repository = mock(SyncRepository.class);
    SyncProperties properties = new SyncProperties();
    properties.setBatchSize(2);
    SyncDownloadService service = new SyncDownloadService(
        repository,
        new SyncNodeAuthService(repository),
        properties);
    when(repository.findDownloadEvents(10L, 100L, 3)).thenReturn(List.of(
        new SyncRepository.CentralOutboxRow(
            101L,
            EventType.PRICE_POLICY_UPDATED,
            AggregateType.PRICE_POLICY,
            "price-7",
            json("{\"storeId\":10,\"unitPrice\":59000}"),
            12L,
            clock.instant(),
            "STORE",
            10L,
            null),
        new SyncRepository.CentralOutboxRow(
            102L,
            EventType.PRODUCT_UPDATED,
            AggregateType.PRODUCT,
            "product-9",
            json("{\"name\":\"Latte\"}"),
            3L,
            clock.instant(),
            "ALL_STORES",
            null,
            null)));

    SyncDtos.SyncDownloadResponse response = service.download(10L, "100", null);

    assertEquals(2, response.events().size());
    assertEquals("102", response.nextCursor());
    assertFalse(response.hasMore());
    assertEquals(EventType.PRICE_POLICY_UPDATED, response.events().getFirst().eventType());
    assertEquals("STORE", response.events().getFirst().targetScope());
    assertEquals(10L, response.events().getFirst().targetStoreId());
  }

  @Test
  void storeCannotDownloadAnotherStoreEvents() {
    RequestUserContextHolder.set(deviceContext(101L, 10L));
    SyncDownloadService service = new SyncDownloadService(
        mock(SyncRepository.class),
        new SyncNodeAuthService(mock(SyncRepository.class)),
        new SyncProperties());

    ServiceException exception = assertThrows(ServiceException.class, () -> service.download(11L, "0", 10));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void applyPricePolicyUsesVersionRule() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncConflictPolicy service = new SyncConflictPolicy(repository);
    SyncDtos.SyncEvent event = new SyncDtos.SyncEvent(
        "101",
        EventType.PRICE_POLICY_UPDATED,
        AggregateType.PRICE_POLICY,
        "price-7",
        12L,
        clock.instant(),
        json("{\"pricePolicyVersion\":12,\"unitPrice\":59000}"));
    when(repository.localVersionIsNewer(AggregateType.PRICE_POLICY.name(), "price-7", 12L))
        .thenReturn(true);

    assertTrue(service.shouldApply(event));

    when(repository.localVersionIsNewer(AggregateType.PRICE_POLICY.name(), "price-7", 12L))
        .thenReturn(false);
    assertFalse(service.shouldApply(event));
  }

  @Test
  void outletTierOnlyPushesStoreOwnedTransactionalAggregates() {
    OutletTierProfile profile = new OutletTierProfile();

    assertEquals(SyncTier.OUTLET, profile.tier());
    assertTrue(profile.upstreamEnabled());
    assertTrue(profile.downstreamEnabled());
    assertTrue(profile.pushUpAggregates().contains(AggregateType.SALE_ORDER));
    assertFalse(profile.pushUpAggregates().contains(AggregateType.PRODUCT));
    assertTrue(profile.pullDownAggregates().contains(AggregateType.PRODUCT));
  }

  @Test
  void regionalTierCanPushLocalTransactionsAndMasterDataUpstream() {
    RegionalTierProfile profile = new RegionalTierProfile();

    assertEquals(SyncTier.REGIONAL, profile.tier());
    assertTrue(profile.upstreamEnabled());
    assertTrue(profile.downstreamEnabled());
    assertTrue(profile.pushUpAggregates().contains(AggregateType.SALE_ORDER));
    assertTrue(profile.pushUpAggregates().contains(AggregateType.PRODUCT));
    assertTrue(profile.pullDownAggregates().contains(AggregateType.TAX_POLICY));
  }

  @Test
  void regionalTierWithoutRuntimeOverrideKeepsLegacyEdgeRole() {
    SyncProperties properties = new SyncProperties();
    properties.setTier(SyncTier.REGIONAL);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncRuntimeRoleResolver resolver = new SyncRuntimeRoleResolver(properties);

    assertEquals(SyncProperties.SyncRuntimeRole.OUTLET_EDGE, properties.effectiveRole());
    assertEquals(SyncRuntimeMode.EDGE_ROLE, resolver.currentMode());
    assertTrue(resolver.isEdgeRole());
    assertFalse(resolver.isHubRole());
  }

  @Test
  void explicitRegionalHubRuntimeRoleResolvesHubMode() {
    SyncProperties properties = new SyncProperties();
    properties.setTier(SyncTier.REGIONAL);
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncRuntimeRoleResolver resolver = new SyncRuntimeRoleResolver(properties);

    assertEquals(SyncProperties.SyncRuntimeRole.REGIONAL_HUB, properties.effectiveRole());
    assertEquals(SyncRuntimeMode.HUB_ROLE, resolver.currentMode());
    assertTrue(resolver.isHubRole());
    assertFalse(resolver.isEdgeRole());
  }

  @Test
  void masterTierDisablesUpstreamAndOnlyPublishesDownstreamMatrix() {
    MasterTierProfile profile = new MasterTierProfile();

    assertEquals(SyncTier.MASTER, profile.tier());
    assertFalse(profile.upstreamEnabled());
    assertTrue(profile.downstreamEnabled());
    assertTrue(profile.pushUpAggregates().isEmpty());
    assertTrue(profile.pullDownAggregates().contains(AggregateType.PRODUCT));
    assertFalse(profile.pullDownAggregates().contains(AggregateType.SALE_ORDER));
  }

  @Test
  void payloadRouterRecordsConflictWhenNoHandlerSupportsEvent() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncConflictPolicy conflictPolicy = mock(SyncConflictPolicy.class);
    SyncPayloadRouter router = new SyncPayloadRouter(List.of(), conflictPolicy, repository);
    SyncDtos.SyncEvent event = orderEvent("order-2", 10L);
    when(conflictPolicy.shouldApply(event)).thenReturn(true);

    boolean applied = router.apply(event);

    assertFalse(applied);
    verify(repository).recordConflict(event, "NO_HANDLER", "No sync payload handler registered");
    verify(conflictPolicy, never()).markApplied(event);
  }

  @Test
  void payloadRouterRecordsApplyFailureWhenHandlerThrows() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncConflictPolicy conflictPolicy = mock(SyncConflictPolicy.class);
    SyncPayloadHandler handler = mock(SyncPayloadHandler.class);
    SyncDtos.SyncEvent event = orderEvent("order-3", 10L);
    when(conflictPolicy.shouldApply(event)).thenReturn(true);
    when(handler.supports(EventType.SALE_ORDER_CREATED, AggregateType.SALE_ORDER)).thenReturn(true);
    doThrow(new IllegalStateException("boom")).when(handler).apply(event);
    SyncPayloadRouter router = new SyncPayloadRouter(List.of(handler), conflictPolicy, repository);

    boolean applied = router.apply(event);

    assertFalse(applied);
    verify(repository).recordConflict(event, "APPLY_FAILED", "boom");
    verify(conflictPolicy, never()).markApplied(event);
  }

  @Test
  void databaseStateStoreDelegatesOffsetAndSyncLogOperations() {
    SyncRepository repository = mock(SyncRepository.class);
    DatabaseSyncStateStore store = new DatabaseSyncStateStore(repository);
    when(repository.readSyncOffset("node-10", "central-outbox")).thenReturn("101");
    when(repository.openSyncLog("node-10", 10L, SyncDirection.CENTRAL_TO_STORE.name(), SyncStatus.PENDING.name(), "start"))
        .thenReturn(77L);

    assertEquals("101", store.readOffset("node-10", "central-outbox"));
    store.saveOffset("node-10", "central-outbox", "102");
    long logId = store.openSyncLog("node-10", 10L, SyncDirection.CENTRAL_TO_STORE, SyncStatus.PENDING, "start");
    store.finishSyncLog(logId, SyncStatus.APPLIED, 2, "done");

    assertEquals(77L, logId);
    verify(repository).saveSyncOffset("node-10", "central-outbox", "102");
    verify(repository).finishSyncLog(77L, SyncStatus.APPLIED.name(), 2, "done");
  }

  @Test
  void hubRuntimeHealthIncludesHubOverviewDetails() {
    SyncRepository repository = mock(SyncRepository.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(repository.hubOverview("region-1")).thenReturn(
        new HubOverviewRow(2L, 1L, 3L, 4L, clock.instant(), clock.instant()));

    SyncRuntimeHealthIndicator indicator = new SyncRuntimeHealthIndicator(properties, repository);
    org.springframework.boot.actuate.health.Health health = indicator.health();

    assertEquals("hubRole", health.getDetails().get("role"));
    assertEquals(2L, health.getDetails().get("managedChildCount"));
    assertEquals(4L, health.getDetails().get("pendingRelayCount"));
  }

  @Test
  void storeAgentMarksPendingEventsFailedWhenCentralUploadFails() {
    SyncStateStore stateStore = mock(SyncStateStore.class);
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncEventApplier applier = mock(SyncEventApplier.class);
    SyncProperties properties = storeProperties();
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    TieredSyncOrchestrator orchestrator = new TieredSyncOrchestrator(
        stateStore,
        client,
        applier,
        profileRegistry,
        properties,
        clock,
        new SimpleMeterRegistry());
    TieredSyncFacade service = new TieredSyncFacade(orchestrator);
    SyncStateStore.PendingOutboundEvent pending = new SyncStateStore.PendingOutboundEvent(
        "event-1",
        EventType.SALE_ORDER_CREATED.name(),
        AggregateType.SALE_ORDER.name(),
        "sale-1",
        json("{\"storeId\":10}"),
        2);
    when(stateStore.claimPendingOutboundEvents(100)).thenReturn(List.of(pending));
    doThrow(new IllegalStateException("network down")).when(client).upload(org.mockito.ArgumentMatchers.any());

    int sent = service.syncUp();

    assertEquals(0, sent);
    verify(stateStore).markOutboundFailed(List.of("event-1"), "network down");
  }

  @Test
  void storeAgentDownloadsAppliesAndAcksCentralEvents() {
    SyncStateStore stateStore = mock(SyncStateStore.class);
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncEventApplier applier = mock(SyncEventApplier.class);
    SyncProperties properties = storeProperties();
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    TieredSyncOrchestrator orchestrator = new TieredSyncOrchestrator(
        stateStore,
        client,
        applier,
        profileRegistry,
        properties,
        clock,
        new SimpleMeterRegistry());
    TieredSyncFacade service = new TieredSyncFacade(orchestrator);
    SyncDtos.SyncEvent event = new SyncDtos.SyncEvent(
        "101",
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "product-9",
        3L,
        clock.instant(),
        json("{\"name\":\"Latte\"}"));
    when(stateStore.readOffset("node-10", "central-outbox")).thenReturn("100");
    when(client.download(10L, "100", 100))
        .thenReturn(new SyncDtos.SyncDownloadResponse(List.of(
            new SyncDtos.SyncDownloadEvent(
                event.eventId(),
                event.eventType(),
                event.aggregateType(),
                event.aggregateId(),
                event.version(),
                event.occurredAt(),
                event.payload(),
                "ALL_STORES",
                null,
                null)), "101", false));
    when(applier.apply(event)).thenReturn(true);

    int received = service.syncDown();

    assertEquals(1, received);
    verify(client).ack(org.mockito.ArgumentMatchers.argThat(request ->
        request.nodeId().equals("node-10")
            && request.storeId().equals(10L)
            && request.events().size() == 1
            && request.events().getFirst().status() == SyncStatus.APPLIED));
    verify(stateStore).saveOffset("node-10", "central-outbox", "101");
  }

  @Test
  void storeAgentAcksConflictWhenApplyReturnsFalse() {
    SyncStateStore stateStore = mock(SyncStateStore.class);
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncEventApplier applier = mock(SyncEventApplier.class);
    SyncProperties properties = storeProperties();
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    TieredSyncOrchestrator orchestrator = new TieredSyncOrchestrator(
        stateStore,
        client,
        applier,
        profileRegistry,
        properties,
        clock,
        new SimpleMeterRegistry());
    TieredSyncFacade service = new TieredSyncFacade(orchestrator);
    SyncDtos.SyncEvent event = new SyncDtos.SyncEvent(
        "102",
        EventType.PRODUCT_UPDATED,
        AggregateType.PRODUCT,
        "product-10",
        4L,
        clock.instant(),
        json("{\"name\":\"Mocha\"}"));
    when(stateStore.readOffset("node-10", "central-outbox")).thenReturn("100");
    when(client.download(10L, "100", 100))
        .thenReturn(new SyncDtos.SyncDownloadResponse(List.of(
            new SyncDtos.SyncDownloadEvent(
                event.eventId(),
                event.eventType(),
                event.aggregateType(),
                event.aggregateId(),
                event.version(),
                event.occurredAt(),
                event.payload(),
                "ALL_STORES",
                null,
                null)), "102", false));
    when(applier.apply(event)).thenReturn(false);

    int received = service.syncDown();

    assertEquals(1, received);
    verify(client).ack(org.mockito.ArgumentMatchers.argThat(request ->
        request.events().size() == 1
            && request.events().getFirst().eventId().equals("102")
            && request.events().getFirst().status() == SyncStatus.REJECTED
            && "Skipped or conflicted during local apply".equals(request.events().getFirst().errorMessage())));
    verify(stateStore).saveOffset("node-10", "central-outbox", "102");
  }

  @Test
  void statusDelegatesAfterScopeCheck() {
    RequestUserContextHolder.set(deviceContext(101L, 10L));
    SyncRepository repository = mock(SyncRepository.class);
    SyncDtos.SyncStatusResponse expected = new SyncDtos.SyncStatusResponse(
        10L,
        clock.instant(),
        clock.instant(),
        1L,
        2L,
        0L,
        clock.instant(),
        0L,
        0L,
        null,
        null);
    when(repository.status(10L)).thenReturn(expected);

    SyncStatusService service = new SyncStatusService(repository, new SyncNodeAuthService(repository));

    assertEquals(expected, service.status(10L));
  }

  @Test
  void controllerDispatchesUploadToCentralFacadeWhenNotHubRole() {
    CentralSyncFacade centralFacade = mock(CentralSyncFacade.class);
    RegionalHubFacade hubFacade = mock(RegionalHubFacade.class);
    SyncProperties properties = new SyncProperties();
    SyncRuntimeRoleResolver resolver = new SyncRuntimeRoleResolver(properties);
    SyncController controller = new SyncController(centralFacade, hubFacade, resolver);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("order-central", 10L));
    SyncDtos.SyncUploadResponse expected = new SyncDtos.SyncUploadResponse(List.of("order-central"), List.of(), List.of());
    when(centralFacade.upload(request)).thenReturn(expected);

    assertEquals(expected, controller.upload(request));
    verify(centralFacade).upload(request);
    verify(hubFacade, never()).upload(request);
  }

  @Test
  void controllerDispatchesUploadToHubFacadeWhenHubRole() {
    CentralSyncFacade centralFacade = mock(CentralSyncFacade.class);
    RegionalHubFacade hubFacade = mock(RegionalHubFacade.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncRuntimeRoleResolver resolver = new SyncRuntimeRoleResolver(properties);
    SyncController controller = new SyncController(centralFacade, hubFacade, resolver);
    SyncDtos.SyncUploadRequest request = uploadRequest("region-1", 20L, orderEvent("order-hub", 20L));
    SyncDtos.SyncUploadResponse expected = new SyncDtos.SyncUploadResponse(List.of("order-hub"), List.of(), List.of());
    when(hubFacade.upload(request)).thenReturn(expected);

    assertEquals(expected, controller.upload(request));
    verify(hubFacade).upload(request);
    verify(centralFacade, never()).upload(request);
  }

  @Test
  void hubScopePolicyAllowsManagedChildNode() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    RegionalHubNodeScopePolicy policy = new RegionalHubNodeScopePolicy(topologyStore, properties);

    NodeTopologyStore.NodeTopology topology = policy.requireManagedChild("node-10", 10L);

    assertEquals("node-10", topology.nodeId());
  }

  @Test
  void hubUploadUsesDownstreamInboxAndPreservesDuplicateHandling() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    DownstreamInboxStore inboxStore = mock(DownstreamInboxStore.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    RegionalIngestRelayEnqueuer relayEnqueuer = mock(RegionalIngestRelayEnqueuer.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    RegionalHubIngestUseCases service =
        new RegionalHubIngestUseCases(
            inboxStore,
            new RegionalHubNodeScopePolicy(topologyStore, properties),
            relayEnqueuer);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("hub-upload-1", 10L));
    when(inboxStore.insertDownstreamInbox("node-10", 10L, request.events().getFirst()))
        .thenReturn(DownstreamInboxStore.IngestResult.DUPLICATED);

    SyncDtos.SyncUploadResponse response = service.upload(request);

    assertEquals(List.of(), response.accepted());
    assertEquals(List.of("hub-upload-1"), response.duplicated());
    verify(relayEnqueuer, never()).enqueueAccepted("node-10", 10L, request.events().getFirst());
  }

  @Test
  void hubUploadEnqueuesAcceptedEventForRelay() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    DownstreamInboxStore inboxStore = mock(DownstreamInboxStore.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    RegionalIngestRelayEnqueuer relayEnqueuer = mock(RegionalIngestRelayEnqueuer.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    when(inboxStore.insertDownstreamInbox(
        org.mockito.ArgumentMatchers.eq("node-10"),
        org.mockito.ArgumentMatchers.eq(10L),
        org.mockito.ArgumentMatchers.any()))
        .thenReturn(DownstreamInboxStore.IngestResult.ACCEPTED);
    RegionalHubIngestUseCases service = new RegionalHubIngestUseCases(
        inboxStore,
        new RegionalHubNodeScopePolicy(topologyStore, properties),
        relayEnqueuer);
    SyncDtos.SyncUploadRequest request = uploadRequest("node-10", 10L, orderEvent("hub-upload-accepted", 10L));

    SyncDtos.SyncUploadResponse response = service.upload(request);

    assertEquals(List.of("hub-upload-accepted"), response.accepted());
    verify(relayEnqueuer).enqueueAccepted("node-10", 10L, request.events().getFirst());
  }

  @Test
  void hubDownloadReadsDownstreamFeedAndStoresHubCursor() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    DownstreamFeedStore feedStore = mock(DownstreamFeedStore.class);
    SyncStateStore stateStore = mock(SyncStateStore.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    RegionalHubFeedUseCases service =
        new RegionalHubFeedUseCases(feedStore, stateStore, new RegionalHubNodeScopePolicy(topologyStore, properties));
    when(feedStore.readDownstreamEvents("node-10", 10L, 100L, 3)).thenReturn(List.of(
        new DownstreamFeedStore.DownstreamEvent(
            101L,
            EventType.PRODUCT_UPDATED.name(),
            AggregateType.PRODUCT.name(),
            "product-1",
            json("{\"name\":\"Latte\"}"),
            3L,
            clock.instant(),
            "ALL_STORES",
            null,
            null),
        new DownstreamFeedStore.DownstreamEvent(
            102L,
            EventType.PRICE_POLICY_UPDATED.name(),
            AggregateType.PRICE_POLICY.name(),
            "price-1",
            json("{\"storeId\":10}"),
            4L,
            clock.instant(),
            "STORE",
            10L,
            null)));

    SyncDtos.SyncDownloadResponse response = service.download("node-10", 10L, "100", 2);

    assertEquals(2, response.events().size());
    assertEquals("102", response.nextCursor());
    assertEquals("ALL_STORES", response.events().getFirst().targetScope());
    verify(stateStore).saveOffset("node-10", "downstream-outbox", "102");
  }

  @Test
  void forwardingPlannerMapsStoreTargetToManagedChildNode() {
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    when(topologyStore.listManagedChildrenByStoreIds("region-1", List.of(10L))).thenReturn(List.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    DownstreamFanoutPlanner planner = new DownstreamFanoutPlanner(topologyStore, properties);

    List<DownstreamFanoutPlanner.RecipientPlan> recipients = planner.planRecipients(
        new SyncDtos.SyncDownloadEvent(
            "101",
            EventType.PRICE_POLICY_UPDATED,
            AggregateType.PRICE_POLICY,
            "price-10",
            2L,
            clock.instant(),
            json("{\"storeId\":10}"),
            "STORE",
            10L,
            null));

    assertEquals(1, recipients.size());
    assertEquals("node-10", recipients.getFirst().targetNodeId());
    assertEquals("NODE", recipients.getFirst().targetScope());
  }

  @Test
  void forwardingPlannerRejectsStoreGroupBroadcastUntilSupported() {
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    DownstreamFanoutPlanner planner = new DownstreamFanoutPlanner(topologyStore, properties);

    assertThrows(IllegalStateException.class, () -> planner.planRecipients(
        new SyncDtos.SyncDownloadEvent(
            "sg-1",
            EventType.PRODUCT_UPDATED,
            AggregateType.PRODUCT,
            "product-sg",
            1L,
            clock.instant(),
            json("{\"name\":\"Latte\"}"),
            "STORE_GROUP",
            null,
            99L)));
  }

  @Test
  void regionalForwardingUseCaseForwardsAllowedCentralEventsToDownstreamFeed() {
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncStateStore stateStore = mock(SyncStateStore.class);
    DownstreamFeedStore downstreamFeedStore = mock(DownstreamFeedStore.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setTier(SyncTier.REGIONAL);
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    DownstreamFanoutPlanner planner = new DownstreamFanoutPlanner(topologyStore, properties);
    RegionalCentralForwardingUseCase useCase = new RegionalCentralForwardingUseCase(
        client, stateStore, downstreamFeedStore, planner, profileRegistry, properties);
    when(stateStore.readOffset("region-1", "central-forwarding-outbox")).thenReturn("100");
    when(topologyStore.listManagedChildrenByStoreIds("region-1", List.of(10L))).thenReturn(List.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    when(client.download(20L, "100", 100)).thenReturn(new SyncDtos.SyncDownloadResponse(List.of(
        new SyncDtos.SyncDownloadEvent(
            "201",
            EventType.PRODUCT_UPDATED,
            AggregateType.PRODUCT,
            "product-1",
            3L,
            clock.instant(),
            json("{\"name\":\"Latte\"}"),
            "STORE",
            10L,
            null)), "201", false));

    int forwarded = useCase.forwardFromCentral();

    assertEquals(1, forwarded);
    verify(downstreamFeedStore).appendDownstreamEvent(
        "node-10",
        EventType.PRODUCT_UPDATED.name(),
        AggregateType.PRODUCT.name(),
        "product-1",
        "NODE",
        10L,
        null,
        "node-10",
        json("{\"name\":\"Latte\"}"),
        3L);
    verify(stateStore).saveOffset("region-1", "central-forwarding-outbox", "201");
  }

  @Test
  void regionalRelayUseCaseGroupsByChildAndMarksAcceptedAndDuplicatedAsSent() {
    RegionalRelayStateStore relayStateStore = mock(RegionalRelayStateStore.class);
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncStateStore syncStateStore = mock(SyncStateStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setTier(SyncTier.REGIONAL);
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    RegionalUpstreamRelayUseCase useCase = new RegionalUpstreamRelayUseCase(
        relayStateStore, client, profileRegistry, syncStateStore, properties);
    when(relayStateStore.claimPendingRelayEvents(100)).thenReturn(List.of(
        new RegionalRelayStateStore.PendingRelayEvent(
            "relay-1", "node-10", 10L,
            EventType.SALE_ORDER_CREATED.name(),
            AggregateType.SALE_ORDER.name(),
            "sale-1", json("{\"storeId\":10}"), 1L, clock.instant(), 0),
        new RegionalRelayStateStore.PendingRelayEvent(
            "relay-2", "node-10", 10L,
            EventType.SALE_ORDER_CREATED.name(),
            AggregateType.SALE_ORDER.name(),
            "sale-2", json("{\"storeId\":10}"), 1L, clock.instant(), 0)));
    when(syncStateStore.openSyncLog("region-1", 20L, SyncDirection.REGION_TO_CENTRAL, SyncStatus.PENDING,
        "Relaying accepted hub ingest events to central")).thenReturn(88L);
    when(client.upload(org.mockito.ArgumentMatchers.any())).thenReturn(
        new SyncDtos.SyncUploadResponse(List.of("relay-1"), List.of("relay-2"), List.of()));

    int relayed = useCase.relayToCentral();

    assertEquals(2, relayed);
    verify(relayStateStore).markRelaySent(List.of("relay-1", "relay-2"));
    verify(relayStateStore).markRelayFailed(List.of(), "Rejected by central sync-service");
  }

  @Test
  void regionalRelayUseCaseMarksClaimedRowsFailedWhenCentralUploadThrows() {
    RegionalRelayStateStore relayStateStore = mock(RegionalRelayStateStore.class);
    SyncTransportClient client = mock(SyncTransportClient.class);
    SyncStateStore syncStateStore = mock(SyncStateStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setTier(SyncTier.REGIONAL);
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    SyncTierProfileRegistry profileRegistry = new SyncTierProfileRegistry(
        List.of(new OutletTierProfile(), new RegionalTierProfile(), new MasterTierProfile()),
        properties);
    RegionalUpstreamRelayUseCase useCase = new RegionalUpstreamRelayUseCase(
        relayStateStore, client, profileRegistry, syncStateStore, properties);
    when(relayStateStore.claimPendingRelayEvents(100)).thenReturn(List.of(
        new RegionalRelayStateStore.PendingRelayEvent(
            "relay-fail-1", "node-10", 10L,
            EventType.SALE_ORDER_CREATED.name(),
            AggregateType.SALE_ORDER.name(),
            "sale-fail-1", json("{\"storeId\":10}"), 1L, clock.instant(), 2)));
    when(syncStateStore.openSyncLog("region-1", 20L, SyncDirection.REGION_TO_CENTRAL, SyncStatus.PENDING,
        "Relaying accepted hub ingest events to central")).thenReturn(99L);
    doThrow(new IllegalStateException("central unavailable")).when(client).upload(org.mockito.ArgumentMatchers.any());

    int relayed = useCase.relayToCentral();

    assertEquals(0, relayed);
    verify(relayStateStore).markRelayFailed(List.of("relay-fail-1"), "central unavailable");
  }

  @Test
  void hubAckWritesDownstreamAckRows() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    DownstreamFeedStore feedStore = mock(DownstreamFeedStore.class);
    SyncStateStore stateStore = mock(SyncStateStore.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    RegionalHubFeedUseCases service =
        new RegionalHubFeedUseCases(feedStore, stateStore, new RegionalHubNodeScopePolicy(topologyStore, properties));

    service.ack(new SyncDtos.SyncAckRequest(
        "node-10",
        10L,
        List.of(new SyncDtos.SyncAckItem("101", SyncStatus.APPLIED, null))));

    verify(feedStore).recordDownstreamAck("101", "node-10", 10L, SyncStatus.APPLIED.name(), null);
  }

  @Test
  void hubStatusReadsHubScopedStatus() {
    RequestUserContextHolder.set(deviceContext(301L, 10L));
    SyncRepository repository = mock(SyncRepository.class);
    NodeTopologyStore topologyStore = mock(NodeTopologyStore.class);
    SyncProperties properties = new SyncProperties();
    properties.setRuntimeRole(SyncProperties.SyncRuntimeRole.REGIONAL_HUB);
    properties.setNodeId("region-1");
    properties.setStoreId("20");
    when(topologyStore.findNodeTopology("node-10")).thenReturn(Optional.of(
        new NodeTopologyStore.NodeTopology("node-10", 10L, "region-1", "STORE", 10L, "OUTLET_EDGE", "ACTIVE")));
    SyncDtos.SyncStatusResponse expected = new SyncDtos.SyncStatusResponse(
        10L, clock.instant(), clock.instant(), 1L, 2L, 0L, clock.instant(), 3L, 1L, clock.instant(), clock.instant());
    when(repository.hubStatus(10L)).thenReturn(expected);
    RegionalHubStatusUseCases service =
        new RegionalHubStatusUseCases(repository, new RegionalHubNodeScopePolicy(topologyStore, properties));

    assertEquals(expected, service.status("node-10", 10L));
  }

  private SyncDtos.SyncUploadRequest uploadRequest(String nodeId, long storeId, SyncDtos.SyncEvent event) {
    return new SyncDtos.SyncUploadRequest(nodeId, storeId, List.of(event));
  }

  private SyncDtos.SyncEvent orderEvent(String eventId, long storeId) {
    return new SyncDtos.SyncEvent(
        eventId,
        EventType.SALE_ORDER_CREATED,
        AggregateType.SALE_ORDER,
        "sale-1",
        1L,
        clock.instant(),
        json("{\"storeId\":" + storeId + ",\"totalAmount\":79000}"));
  }

  private RequestUserContext deviceContext(long deviceId, long storeId) {
    return new RequestUserContext(
        null,
        null,
        null,
        Set.of(),
        Set.of(),
        Set.of(),
        true,
        false,
        null,
        deviceId,
        storeId);
  }

  private SyncProperties storeProperties() {
    SyncProperties properties = new SyncProperties();
    properties.setMode(SyncProperties.SyncMode.STORE);
    properties.setBatchSize(100);
    properties.setNodeId("node-10");
    properties.setStoreId("10");
    return properties;
  }

  private JsonNode json(String raw) {
    try {
      return objectMapper.readTree(raw);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }
}
