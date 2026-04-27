package com.fern.services.inventory.application;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.dorabets.idempotency.model.TtlPolicy;
import com.dorabets.common.spring.auth.InternalExecutionContext;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCancelledEvent;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class InventoryEventConsumer {

  private static final Logger log = LoggerFactory.getLogger(InventoryEventConsumer.class);

  private final InventoryService inventoryService;
  private final IdempotencyGuard idempotencyGuard;
  private final ObjectMapper objectMapper;

  public InventoryEventConsumer(
      InventoryService inventoryService,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper
  ) {
    this.inventoryService = inventoryService;
    this.idempotencyGuard = idempotencyGuard;
    this.objectMapper = objectMapper;
  }

  @KafkaListener(topics = "fern.sales.sale-approved")
  public void consumeSaleApproved(String message) {
    InternalExecutionContext.run("inventory-service", () -> consumeSaleApprovedInternal(message));
  }

  private void consumeSaleApprovedInternal(String message) {
    try {
      EventEnvelope<SaleApprovedEvent> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<SaleApprovedEvent>>() {
          }
      );
      SaleApprovedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring sale-approved event with empty payload");
        return;
      }
      idempotencyGuard.execute(
          "inventory-service",
          envelope.eventId(),
          message,
          TtlPolicy.BET,
          () -> {
            int movements = inventoryService.applySaleApproved(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "saleId", event.saleId(),
                "movements", movements
            )), Long.toString(event.saleId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.sales.sale-approved", ex);
    }
  }

  @KafkaListener(topics = "fern.sales.sale-cancelled")
  public void consumeSaleCancelled(String message) {
    InternalExecutionContext.run("inventory-service", () -> consumeSaleCancelledInternal(message));
  }

  private void consumeSaleCancelledInternal(String message) {
    try {
      EventEnvelope<SaleCancelledEvent> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<SaleCancelledEvent>>() {
          }
      );
      SaleCancelledEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring sale-cancelled event with empty payload");
        return;
      }
      idempotencyGuard.execute(
          "inventory-service",
          envelope.eventId(),
          message,
          TtlPolicy.BET,
          () -> {
            int movements = inventoryService.applySaleCancelled(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "saleId", event.saleId(),
                "reversals", movements
            )), Long.toString(event.saleId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.sales.sale-cancelled", ex);
    }
  }

  @KafkaListener(topics = "fern.procurement.goods-receipt-posted")
  public void consumeGoodsReceiptPosted(String message) {
    InternalExecutionContext.run("inventory-service", () -> consumeGoodsReceiptPostedInternal(message));
  }

  private void consumeGoodsReceiptPostedInternal(String message) {
    try {
      EventEnvelope<GoodsReceiptPostedEvent> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<GoodsReceiptPostedEvent>>() {
          }
      );
      GoodsReceiptPostedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring goods-receipt-posted event with empty payload");
        return;
      }
      idempotencyGuard.execute(
          "inventory-service",
          envelope.eventId(),
          message,
          TtlPolicy.BET,
          () -> {
            int movements = inventoryService.applyGoodsReceiptPosted(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "goodsReceiptId", event.goodsReceiptId(),
                "movements", movements
            )), Long.toString(event.goodsReceiptId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.procurement.goods-receipt-posted", ex);
    }
  }

  private String jsonBody(Map<String, Object> body) {
    try {
      return objectMapper.writeValueAsString(body);
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to serialize idempotency response body", ex);
    }
  }
}
