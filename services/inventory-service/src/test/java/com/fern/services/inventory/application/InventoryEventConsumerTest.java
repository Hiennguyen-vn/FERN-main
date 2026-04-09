package com.fern.services.inventory.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.procurement.GoodsReceiptPostedLineItem;
import com.fern.events.sales.SaleCompletedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
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
  void consumeSaleCompletedUsesIdempotencyAndDelegatesToService() throws Exception {
    InventoryEventConsumer consumer = new InventoryEventConsumer(inventoryService, idempotencyGuard, objectMapper);
    SaleCompletedEvent payload = new SaleCompletedEvent(
        40L,
        7L,
        LocalDate.parse("2026-03-27"),
        "USD",
        List.of(new SaleCompletedLineItem(
            88L,
            new BigDecimal("2.0000"),
            new BigDecimal("10.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("20.00")
        )),
        new BigDecimal("20.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("20.00"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    String rawMessage = objectMapper.writeValueAsString(
        EventEnvelope.create("sales.sale.completed", "40", payload, "sales-service")
    );

    when(inventoryService.applySaleCompleted(payload)).thenReturn(1);
    when(idempotencyGuard.execute(eq("inventory-service"), any(), eq(rawMessage), any(), any()))
        .thenAnswer(invocation -> ((Supplier<IdempotencyResult>) invocation.getArgument(4)).get());

    consumer.consumeSaleCompleted(rawMessage);

    verify(inventoryService).applySaleCompleted(payload);
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
}
