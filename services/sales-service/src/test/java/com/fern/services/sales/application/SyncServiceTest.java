package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.outbox.OutboxWriter;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.SyncDtos;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class SyncServiceTest {

  private final SalesService salesService = mock(SalesService.class);
  private final DataSource dataSource = mock(DataSource.class);
  private final OutboxWriter outboxWriter = mock(OutboxWriter.class);
  private final DeviceService deviceService = mock(DeviceService.class);
  private final PosMetrics posMetrics = new PosMetrics(new SimpleMeterRegistry(), mock(DataSource.class));

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void pushRoutesSalesAndSessionEventsWithoutIdempotencyLookup() {
    RequestUserContextHolder.set(RequestUserContext.anonymous());
    SyncService service = newService();
    SyncDtos.PushRequest request = new SyncDtos.PushRequest(
        "101",
        List.of(
            event("void-1", "pos.sale.voided", Map.of("sale_id", 5001L, "reason", "mistake")),
            event("submit-1", "pos.sale.submitted", Map.of(
                "outlet_id", 10L,
                "pos_session_id", 7001L,
                "currency_code", "USD",
                "items", List.of(Map.of("product_id", 9501L, "quantity", "2.0000")))),
            event("approve-1", "pos.sale.approved", Map.of("sale_id", 5001L, "actor_user_id", 2L)),
            event("pay-1", "pos.payment.captured", Map.of(
                "sale_id", 5001L,
                "amount", "70000.00",
                "payment_method", "cash",
                "client_occurred_at", "2026-04-27T10:00:00Z")),
            event("open-session-1", "pos.session.opened", Map.of(
                "outlet_id", 10L,
                "manager_user_id", 2L,
                "currency_code", "USD",
                "business_date", "2026-04-27")),
            event("close-session-1", "pos.session.closed", Map.of("session_id", 7001L))));

    SyncDtos.PushResponse response = service.push(request, deviceService);

    assertEquals(List.of("void-1", "submit-1", "approve-1", "pay-1", "open-session-1", "close-session-1"),
        response.accepted());
    assertEquals(List.of(), response.rejected());
    verify(deviceService).recordLastSeen(101L);
    verify(salesService).voidSaleFromSync(5001L, "mistake");
    verify(salesService).submitSaleFromSync(any());
    verify(salesService).approveSaleFromSync(any());
    verify(salesService).capturePaymentFromSync(any());
    verify(salesService).openPosSessionFromSync(any());
    verify(salesService).closePosSessionFromSync(7001L);
  }

  @Test
  void pushRejectsRefundEventButContinuesBatch() {
    RequestUserContextHolder.set(RequestUserContext.anonymous());
    SyncService service = newService();
    SyncDtos.PushRequest request = new SyncDtos.PushRequest(
        "101",
        List.of(
            event("refund-1", "pos.sale.refunded", Map.of("sale_id", 5001L)),
            event("void-1", "pos.sale.voided", Map.of("sale_id", 5002L))));

    SyncDtos.PushResponse response = service.push(request, deviceService);

    assertEquals(List.of("void-1"), response.accepted());
    assertEquals(1, response.rejected().size());
    assertEquals("refund-1", response.rejected().getFirst().eventId());
    verify(salesService).voidSaleFromSync(5002L, "voided_offline");
  }

  @Test
  void pushRejectsDevicePayloadForAnotherOutletBeforeRouting() {
    RequestUserContextHolder.set(new RequestUserContext(
        null,
        "edge-device",
        null,
        Set.of(),
        Set.of(),
        Set.of(10L),
        true,
        false,
        null,
        101L,
        10L));
    SyncService service = newService();
    SyncDtos.PushRequest request = new SyncDtos.PushRequest(
        "101",
        List.of(event("submit-1", "pos.sale.submitted", Map.of("outlet_id", 11L))));

    ServiceException exception = assertThrows(ServiceException.class, () -> service.push(request, deviceService));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void pushQueuesInventoryEventsToOutboxWhenPayloadMatchesDeviceContext() throws Exception {
    RequestUserContextHolder.set(new RequestUserContext(
        null,
        "edge-device",
        null,
        Set.of(),
        Set.of(),
        Set.of(10L),
        true,
        false,
        null,
        101L,
        10L));
    Connection conn = mock(Connection.class);
    Statement statement = mock(Statement.class);
    when(dataSource.getConnection()).thenReturn(conn);
    when(conn.createStatement()).thenReturn(statement);
    SyncService service = newService();

    SyncDtos.PushRequest request = new SyncDtos.PushRequest(
        "101",
        List.of(
            event("stock-in-1", "pos.inventory.stock-in.recorded", stockInPayload()),
            event("waste-1", "pos.inventory.waste.recorded", wastePayload())));

    SyncDtos.PushResponse response = service.push(request, deviceService);

    assertEquals(List.of("stock-in-1", "waste-1"), response.accepted());
    assertEquals(List.of(), response.rejected());
    verify(outboxWriter).append(
        eq(conn), eq("inventory.stock-in.recorded"), eq(9001L),
        eq("fern.inventory.stock-in-recorded"), eq("9001"), any());
    verify(outboxWriter).append(
        eq(conn), eq("inventory.waste.recorded"), eq(9101L),
        eq("fern.inventory.waste-recorded"), eq("9101"), any());
  }

  private SyncService newService() {
    return new SyncService(
        dataSource,
        salesService,
        posMetrics,
        mock(SnowflakeIdGenerator.class),
        new ObjectMapper().findAndRegisterModules(),
        outboxWriter);
  }

  private SyncDtos.PushEvent event(String id, String type, Object payload) {
    return new SyncDtos.PushEvent(
        id,
        null,
        type,
        "2026-04-27T10:00:00Z",
        null,
        1L,
        payload);
  }

  private Map<String, Object> stockInPayload() {
    return Map.ofEntries(
        Map.entry("event_id", "9001"),
        Map.entry("type", "STOCK_IN_SIMPLE"),
        Map.entry("outlet_id", 10L),
        Map.entry("device_id", 101L),
        Map.entry("pos_session_id", 7001L),
        Map.entry("terminal_id", "REGISTER-A"),
        Map.entry("actor_user_id", 2L),
        Map.entry("item_id", 8801L),
        Map.entry("quantity", new BigDecimal("3.0000")),
        Map.entry("reason", "EMERGENCY_RECEIPT"),
        Map.entry("note", "Received from local storage"),
        Map.entry("created_at_device", Instant.parse("2026-04-27T10:00:00Z").toString()),
        Map.entry("business_date", LocalDate.parse("2026-04-27").toString()));
  }

  private Map<String, Object> wastePayload() {
    return Map.ofEntries(
        Map.entry("event_id", "9101"),
        Map.entry("movement_type", "WASTE"),
        Map.entry("outlet_id", 10L),
        Map.entry("device_id", 101L),
        Map.entry("pos_session_id", 7001L),
        Map.entry("terminal_id", "REGISTER-A"),
        Map.entry("actor_user_id", 2L),
        Map.entry("item_id", 8801L),
        Map.entry("quantity", new BigDecimal("1.0000")),
        Map.entry("reason", "SPILL"),
        Map.entry("created_at_device", Instant.parse("2026-04-27T10:05:00Z").toString()));
  }
}
