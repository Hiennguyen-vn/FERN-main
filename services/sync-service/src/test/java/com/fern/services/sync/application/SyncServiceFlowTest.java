package com.fern.services.sync.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import com.fern.services.sync.infrastructure.SyncRepository.UploadInsertResult;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import com.fern.services.sync.model.SyncStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
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
            clock.instant()),
        new SyncRepository.CentralOutboxRow(
            102L,
            EventType.PRODUCT_UPDATED,
            AggregateType.PRODUCT,
            "product-9",
            json("{\"name\":\"Latte\"}"),
            3L,
            clock.instant())));

    SyncDtos.SyncDownloadResponse response = service.download(10L, "100", null);

    assertEquals(2, response.events().size());
    assertEquals("102", response.nextCursor());
    assertFalse(response.hasMore());
    assertEquals(EventType.PRICE_POLICY_UPDATED, response.events().getFirst().eventType());
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
    SyncApplyService service = new SyncApplyService(repository);
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
  void storeAgentMarksPendingEventsFailedWhenCentralUploadFails() {
    SyncRepository repository = mock(SyncRepository.class);
    CentralSyncClient client = mock(CentralSyncClient.class);
    SyncProperties properties = storeProperties();
    StoreSyncAgentService service = new StoreSyncAgentService(repository, client, properties, clock);
    SyncRepository.LocalOutboxRow pending = new SyncRepository.LocalOutboxRow(
        "event-1",
        EventType.SALE_ORDER_CREATED.name(),
        AggregateType.SALE_ORDER.name(),
        "sale-1",
        json("{\"storeId\":10}"),
        2);
    when(repository.claimPendingLocalOutbox(100)).thenReturn(List.of(pending));
    doThrow(new IllegalStateException("network down")).when(client).upload(org.mockito.ArgumentMatchers.any());

    int sent = service.uploadPendingEvents();

    assertEquals(0, sent);
    verify(repository).markLocalOutboxFailed(List.of("event-1"), "network down");
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
        clock.instant());
    when(repository.status(10L)).thenReturn(expected);

    SyncStatusService service = new SyncStatusService(repository, new SyncNodeAuthService(repository));

    assertEquals(expected, service.status(10L));
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
