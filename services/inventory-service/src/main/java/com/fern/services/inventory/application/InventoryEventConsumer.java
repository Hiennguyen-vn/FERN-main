package com.fern.services.inventory.application;

import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.dorabets.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.sales.SaleCompletedEvent;
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

  @KafkaListener(topics = "fern.sales.sale-completed")
  public void consumeSaleCompleted(String message) {
    try {
      EventEnvelope<SaleCompletedEvent> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<SaleCompletedEvent>>() {
          }
      );
      SaleCompletedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring sale-completed event with empty payload");
        return;
      }
      idempotencyGuard.execute(
          "inventory-service",
          envelope.eventId(),
          message,
          TtlPolicy.BET,
          () -> {
            int movements = inventoryService.applySaleCompleted(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "saleId", event.saleId(),
                "movements", movements
            )), Long.toString(event.saleId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.sales.sale-completed", ex);
    }
  }

  @KafkaListener(topics = "fern.procurement.goods-receipt-posted")
  public void consumeGoodsReceiptPosted(String message) {
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
