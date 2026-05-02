package com.fern.services.inventory.application;

import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fern.common.spring.auth.InternalExecutionContext;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fern.events.core.EventEnvelope;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.inventory.OfflineInventoryMovementRecordedEvent;
import com.fern.events.inventory.StockInSimpleRecordedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCancelledEvent;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.DltHandler;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.kafka.retrytopic.DltStrategy;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.retry.annotation.Backoff;
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

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
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
          idempotencyKey(envelope),
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

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
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
          idempotencyKey(envelope),
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

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
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
          idempotencyKey(envelope),
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

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
  @KafkaListener(topics = "fern.inventory.stock-in-recorded")
  public void consumeStockInRecorded(String message) {
    InternalExecutionContext.run("inventory-service", () -> consumeStockInRecordedInternal(message));
  }

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
  @KafkaListener(topics = "fern.inventory.waste-recorded")
  public void consumeWasteRecorded(String message) {
    InternalExecutionContext.run("inventory-service", () -> consumeWasteRecordedInternal(message));
  }

  @DltHandler
  public void handleDlt(String message, @Header(KafkaHeaders.ORIGINAL_TOPIC) String topic) {
    log.error("Inventory DLT: topic={} payload={}", topic, message);
  }

  private void consumeStockInRecordedInternal(String message) {
    try {
      EventEnvelope<JsonNode> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<JsonNode>>() {
          }
      );
      JsonNode payload = envelope.payload();
      if (payload == null || payload.isNull()) {
        log.warn("Ignoring stock-in-recorded event with empty payload");
        return;
      }
      StockInSimpleRecordedEvent event = objectMapper.treeToValue(
          normalizeStockInPayload(payload),
          StockInSimpleRecordedEvent.class
      );
      String idempotencyKey = event.sourceEventId() == null || event.sourceEventId().isBlank()
          ? envelope.eventId()
          : event.sourceEventId();
      idempotencyGuard.execute(
          "inventory-service",
          idempotencyKey,
          stablePayloadBody(event),
          TtlPolicy.BET,
          () -> {
            InventoryRepository.OfflineStockInResult result = inventoryService.applyOfflineStockIn(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "sourceEventId", idempotencyKey,
                "status", result.status()
            )), result.inventoryTransactionId() == null ? idempotencyKey : Long.toString(result.inventoryTransactionId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.inventory.stock-in-recorded", ex);
    }
  }

  private void consumeWasteRecordedInternal(String message) {
    try {
      EventEnvelope<JsonNode> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<JsonNode>>() {
          }
      );
      JsonNode payload = envelope.payload();
      if (payload == null || payload.isNull()) {
        log.warn("Ignoring waste-recorded event with empty payload");
        return;
      }
      OfflineInventoryMovementRecordedEvent event = objectMapper.treeToValue(
          normalizeStockInPayload(payload),
          OfflineInventoryMovementRecordedEvent.class
      );
      String idempotencyKey = event.sourceEventId() == null || event.sourceEventId().isBlank()
          ? envelope.eventId()
          : event.sourceEventId();
      idempotencyGuard.execute(
          "inventory-service",
          idempotencyKey,
          stablePayloadBody(event),
          TtlPolicy.BET,
          () -> {
            InventoryRepository.OfflineInventoryMovementResult result = inventoryService.applyOfflineWaste(event);
            return IdempotencyResult.created(jsonBody(Map.of(
                "sourceEventId", idempotencyKey,
                "status", result.status()
            )), result.inventoryTransactionId() == null ? idempotencyKey : Long.toString(result.inventoryTransactionId()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.inventory.waste-recorded", ex);
    }
  }

  private JsonNode normalizeStockInPayload(JsonNode payload) {
    if (!payload.isObject()) {
      return payload;
    }
    ObjectNode input = (ObjectNode) payload;
    ObjectNode normalized = objectMapper.createObjectNode();
    copyFirst(normalized, input, "event_id", "event_id", "eventId", "source_event_id", "sourceEventId");
    copyFirst(normalized, input, "idempotency_key", "idempotency_key", "idempotencyKey");
    copyFirst(normalized, input, "movement_type", "movement_type", "movementType", "type");
    copyFirst(normalized, input, "type", "type");
    copyFirst(normalized, input, "outlet_id", "outlet_id", "outletId");
    copyFirst(normalized, input, "device_id", "device_id", "deviceId");
    copyFirst(normalized, input, "pos_session_id", "pos_session_id", "posSessionId");
    copyFirst(normalized, input, "terminal_id", "terminal_id", "terminalId", "register_code", "registerCode");
    copyFirst(normalized, input, "actor_user_id", "actor_user_id", "actorUserId");
    copyFirst(normalized, input, "actor_username", "actor_username", "actorUsername");
    copyFirst(normalized, input, "item_id", "item_id", "itemId");
    copyFirst(normalized, input, "sku", "sku");
    copyFirst(normalized, input, "quantity", "quantity");
    copyFirst(normalized, input, "unit", "unit");
    copyFirst(normalized, input, "unit_cost", "unit_cost", "unitCost");
    copyFirst(normalized, input, "reason", "reason");
    copyFirst(normalized, input, "note", "note");
    copyFirst(normalized, input, "business_date", "business_date", "businessDate");
    copyFirst(normalized, input, "created_at_device", "created_at_device", "createdAtDevice");
    copyFirst(normalized, input, "source", "source");
    copyFirst(normalized, input, "needs_review", "needs_review", "needsReview");
    return normalized;
  }

  private void copyFirst(ObjectNode target, ObjectNode source, String targetName, String... sourceNames) {
    for (String sourceName : sourceNames) {
      JsonNode value = source.get(sourceName);
      if (value != null && !value.isNull()) {
        target.set(targetName, value);
        return;
      }
    }
  }

  private String jsonBody(Map<String, Object> body) {
    try {
      return objectMapper.writeValueAsString(body);
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to serialize idempotency response body", ex);
    }
  }

  private String stablePayloadBody(Object payload) {
    try {
      return objectMapper.writeValueAsString(payload);
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to serialize idempotency request body", ex);
    }
  }

  /** Composite idempotency key disambiguates per-aggregate retries. */
  private static String idempotencyKey(EventEnvelope<?> envelope) {
    return envelope.eventId() + ":" + envelope.aggregateId();
  }
}
