package com.fern.services.inventory.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.idempotency.model.IdempotencyResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.inventory.OfflineInventoryMovementRecordedEvent;
import com.fern.events.inventory.StockInSimpleRecordedEvent;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.procurement.GoodsReceiptPostedLineItem;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InventoryEventConsumerTest {

  @Mock
  private InventoryService inventoryService;
  @Mock
  private IdempotencyGuard idempotencyGuard;

  private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

  @Test
  void consumeSaleApprovedUsesIdempotencyAndDelegatesToService() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    SaleApprovedEvent payload = new SaleApprovedEvent(
        40L,
        7L,
        LocalDate.parse("2026-03-27"),
        Instant.parse("2026-03-27T00:00:00Z"),
        9L,
        false,
        false,
        List.of(new SaleCompletedLineItem(
            88L,
            new BigDecimal("2.0000"),
            new BigDecimal("10.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("20.00")
        )),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("sales.sale.approved", "40", payload, "sales-service")
    );

    when(inventoryService.applySaleApproved(payload)).thenReturn(1);
    when(idempotencyGuard.execute(eq("inventory-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeSaleApproved(rawMessage);

    verify(inventoryService).applySaleApproved(payload);
  }

  @Test
  void consumeGoodsReceiptPostedUsesIdempotencyAndDelegatesToService() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    GoodsReceiptPostedEvent payload = new GoodsReceiptPostedEvent(
        61L,
        70L,
        80L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        List.of(new GoodsReceiptPostedLineItem(
            88L,
            "kg",
            new BigDecimal("2.0000"),
            new BigDecimal("5.00"),
            new BigDecimal("10.00")
        )),
        new BigDecimal("10.00"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("procurement.goods-receipt-posted", "61", payload, "procurement-service")
    );

    when(inventoryService.applyGoodsReceiptPosted(payload)).thenReturn(1);
    when(idempotencyGuard.execute(eq("inventory-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeGoodsReceiptPosted(rawMessage);

    verify(inventoryService).applyGoodsReceiptPosted(payload);
  }

  @Test
  void consumeStockInRecordedUsesSourceEventIdAndDelegatesToService() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    StockInSimpleRecordedEvent payload = new StockInSimpleRecordedEvent(
        "9001",
        "idem-stock-in-1",
        "STOCK_IN_SIMPLE",
        7L,
        101L,
        501L,
        "REGISTER-A",
        11L,
        "manager-1",
        88L,
        "MILK",
        new BigDecimal("10.0"),
        "pcs",
        "EMERGENCY_RECEIPT",
        "Received from local storage",
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T10:00:00Z"),
        "POS_OFFLINE",
        true
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("inventory.stock-in.recorded", "9001", payload, "sales-service")
    );

    when(inventoryService.applyOfflineStockIn(payload))
        .thenReturn(new InventoryRepository.OfflineStockInResult("APPLIED", 7001L, null, false));
    when(idempotencyGuard.execute(eq("inventory-service"), eq("9001"), any(), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeStockInRecorded(rawMessage);

    verify(inventoryService).applyOfflineStockIn(payload);
  }

  @Test
  void consumeStockInRecordedAcceptsDuplicateSnakeAndCamelPayloadFields() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    StockInSimpleRecordedEvent expected = new StockInSimpleRecordedEvent(
        "9001",
        "idem-stock-in-1",
        "STOCK_IN_SIMPLE",
        7L,
        101L,
        501L,
        "REGISTER-A",
        11L,
        "manager-1",
        88L,
        "MILK",
        new BigDecimal("10.0000"),
        "pcs",
        "EMERGENCY_RECEIPT",
        "Received from local storage",
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T10:00:00Z"),
        "POS_OFFLINE",
        true
    );
    String rawMessage = """
        {
          "eventId": "envelope-1",
          "aggregateId": "9001",
          "eventType": "inventory.stock-in.recorded",
          "timestamp": "2026-04-27T10:00:01Z",
          "sourceComponent": "sales-service",
          "version": 1,
          "payload": {
            "eventId": "9001",
            "event_id": "9001",
            "idempotencyKey": "idem-stock-in-1",
            "idempotency_key": "idem-stock-in-1",
            "type": "STOCK_IN_SIMPLE",
            "outletId": "7",
            "outlet_id": "7",
            "deviceId": "101",
            "device_id": "101",
            "posSessionId": "501",
            "pos_session_id": "501",
            "terminalId": "REGISTER-A",
            "terminal_id": "REGISTER-A",
            "actorUserId": 11,
            "actor_user_id": 11,
            "actorUsername": "manager-1",
            "actor_username": "manager-1",
            "itemId": "88",
            "item_id": "88",
            "sku": "MILK",
            "quantity": "10.0000",
            "unit": "pcs",
            "reason": "EMERGENCY_RECEIPT",
            "note": "Received from local storage",
            "businessDate": "2026-04-27",
            "business_date": "2026-04-27",
            "createdAtDevice": "2026-04-27T10:00:00Z",
            "created_at_device": "2026-04-27T10:00:00Z",
            "source": "POS_OFFLINE",
            "needsReview": true,
            "needs_review": true
          }
        }
        """;

    when(inventoryService.applyOfflineStockIn(expected))
        .thenReturn(new InventoryRepository.OfflineStockInResult("APPLIED", 7001L, null, false));
    when(idempotencyGuard.execute(eq("inventory-service"), eq("9001"), any(), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeStockInRecorded(rawMessage);

    verify(inventoryService).applyOfflineStockIn(expected);
  }

  @Test
  void consumeWasteRecordedUsesSourceEventIdAndDelegatesToService() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    OfflineInventoryMovementRecordedEvent expected = new OfflineInventoryMovementRecordedEvent(
        "9101",
        "idem-waste-1",
        "WASTE",
        7L,
        101L,
        501L,
        "REGISTER-A",
        11L,
        "manager-1",
        88L,
        "MILK",
        new BigDecimal("2.0000"),
        "pcs",
        null,
        "SPILL",
        "Dropped during prep",
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T10:10:00Z"),
        "POS_OFFLINE",
        true
    );
    String rawMessage = """
        {
          "eventId": "envelope-waste-1",
          "aggregateId": "9101",
          "eventType": "inventory.waste.recorded",
          "timestamp": "2026-04-27T10:10:01Z",
          "sourceComponent": "sales-service",
          "version": 1,
          "payload": {
            "event_id": "9101",
            "idempotency_key": "idem-waste-1",
            "movement_type": "WASTE",
            "type": "WASTE",
            "outlet_id": "7",
            "device_id": "101",
            "pos_session_id": "501",
            "terminal_id": "REGISTER-A",
            "actor_user_id": 11,
            "actor_username": "manager-1",
            "item_id": "88",
            "sku": "MILK",
            "quantity": "2.0000",
            "unit": "pcs",
            "reason": "SPILL",
            "note": "Dropped during prep",
            "business_date": "2026-04-27",
            "created_at_device": "2026-04-27T10:10:00Z",
            "source": "POS_OFFLINE",
            "needs_review": true
          }
        }
        """;

    when(inventoryService.applyOfflineWaste(expected))
        .thenReturn(new InventoryRepository.OfflineInventoryMovementResult("APPLIED", 7101L, null, false));
    when(idempotencyGuard.execute(eq("inventory-service"), eq("9101"), any(), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeWasteRecorded(rawMessage);

    verify(inventoryService).applyOfflineWaste(expected);
  }
}
