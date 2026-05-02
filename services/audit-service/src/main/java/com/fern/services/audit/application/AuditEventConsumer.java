package com.fern.services.audit.application;

import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fern.events.core.EventEnvelope;
import com.fern.services.audit.infrastructure.AuditRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Instant;
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
public class AuditEventConsumer {

  private static final Logger log = LoggerFactory.getLogger(AuditEventConsumer.class);
  private final AuditRepository auditRepository;
  private final IdempotencyGuard idempotencyGuard;
  private final ObjectMapper objectMapper;
  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public AuditEventConsumer(
      AuditRepository auditRepository,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper,
      SnowflakeIdGenerator snowflakeIdGenerator
  ) {
    this.auditRepository = auditRepository;
    this.idempotencyGuard = idempotencyGuard;
    this.objectMapper = objectMapper;
    this.snowflakeIdGenerator = snowflakeIdGenerator;
  }

  @RetryableTopic(
      attempts = "3",
      backoff = @Backoff(delay = 1000, multiplier = 4.0),
      dltStrategy = DltStrategy.FAIL_ON_ERROR,
      autoCreateTopics = "true"
  )
  @KafkaListener(topics = {
      "fern.auth.user-created",
      "fern.auth.role-updated",
      "fern.auth.user-role-changed",
      "fern.org.region-created",
      "fern.org.region-updated",
      "fern.org.outlet-created",
      "fern.org.outlet-updated",
      "fern.org.exchange-rate-updated",
      "fern.product.product-price-changed",
      "fern.product.product-recipe-updated",
      "fern.sales.sale-approved",
      "fern.sales.sale-completed",
      "fern.sales.sale-cancelled",
      "fern.sales.payment-captured",
      "fern.sales.inventory-oversell",
      "fern.procurement.goods-receipt-posted",
      "fern.procurement.invoice-approved",
      "fern.inventory.stock-low-threshold",
      "fern.inventory.stock-in-recorded",
      "fern.inventory.waste-recorded",
      "fern.audit.pos-recorded",
      "fern.payroll.payroll-approved",
      "fern.finance.invoice-issued",
      "fern.finance.expense-record-created"
  })
  public void consume(String message) {
    try {
      EventEnvelope<JsonNode> envelope = objectMapper.readValue(
          message,
          new TypeReference<EventEnvelope<JsonNode>>() {
          }
      );
      if (envelope.payload() == null) {
        return;
      }
      idempotencyGuard.execute(
          "audit-service",
          idempotencyKey(envelope),
          message,
          TtlPolicy.BET,
          () -> {
            AuditRepository.AuditEntry entry = toAuditEntry(envelope);
            auditRepository.append(entry);
            return IdempotencyResult.created(jsonBody(Map.of("auditLogId", entry.id())), Long.toString(entry.id()));
          }
      );
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process audit event", ex);
    }
  }

  private AuditRepository.AuditEntry toAuditEntry(EventEnvelope<JsonNode> envelope) {
    JsonNode payload = enrichPayload(envelope);
    return new AuditRepository.AuditEntry(
        snowflakeIdGenerator.generateId(),
        extractActorUserId(payload),
        mapAction(envelope.eventType()),
        mapEntityName(envelope.eventType()),
        resolveEntityId(envelope, payload),
        envelope.eventType(),
        null,
        payload,
        null,
        null,
        envelope.timestamp() == null ? Instant.now() : envelope.timestamp()
    );
  }

  private JsonNode enrichPayload(EventEnvelope<JsonNode> envelope) {
    JsonNode payload = envelope.payload();
    if (payload == null || !payload.isObject()) {
      return payload;
    }
    ObjectNode copy = ((ObjectNode) payload).deepCopy();
    putIfMissing(copy, "sourceEventId", envelope.eventId());
    putIfMissing(copy, "aggregateId", envelope.aggregateId());
    putIfMissing(copy, "eventType", envelope.eventType());
    putIfMissing(copy, "sourceService", envelope.sourceComponent());
    if (envelope.timestamp() != null) {
      putIfMissing(copy, "eventTimestamp", envelope.timestamp().toString());
    }
    return copy;
  }

  private void putIfMissing(ObjectNode node, String field, String value) {
    if (value == null || value.isBlank()) {
      return;
    }
    JsonNode existing = node.get(field);
    if (existing == null || existing.isNull() || existing.asText().isBlank()) {
      node.put(field, value);
    }
  }

  private Long extractActorUserId(JsonNode payload) {
    String[] candidates = {"actorUserId", "approvedByUserId", "createdByUserId", "userId", "managerId"};
    for (String candidate : candidates) {
      JsonNode node = payload.get(candidate);
      if (node != null && node.isNumber()) {
        long value = node.asLong();
        if (value > 0) {
          return value;
        }
      }
    }
    return null;
  }

  private String resolveEntityId(EventEnvelope<JsonNode> envelope, JsonNode payload) {
    String eventSpecific = resolveEventSpecificEntityId(envelope.eventType(), payload);
    if (eventSpecific != null) {
      return eventSpecific;
    }
    String[] candidates = {
        "saleId",
        "goodsReceiptId",
        "supplierInvoiceId",
        "payrollId",
        "expenseRecordId",
        "outletId",
        "productId",
        "userId",
        "roleCode"
    };
    for (String candidate : candidates) {
      JsonNode node = payload.get(candidate);
      if (node != null && !node.isNull()) {
        return node.isTextual() ? node.asText() : node.asText();
      }
    }
    return envelope.aggregateId();
  }

  private String resolveEventSpecificEntityId(String eventType, JsonNode payload) {
    return switch (eventType) {
      case "product.price.changed", "product.recipe.updated" -> textValue(payload, "productId");
      case "org.outlet.created", "org.outlet.updated" -> textValue(payload, "outletId");
      case "org.region.created", "org.region.updated" -> textValue(payload, "regionId");
      case "auth.user.created" -> textValue(payload, "userId");
      case "auth.role.updated" -> textValue(payload, "roleCode");
      case "auth.user-role-changed" -> textValue(payload, "userRoleId");
      case "sales.sale.completed", "sales.payment.captured" -> textValue(payload, "saleId");
      case "procurement.goods-receipt-posted" -> textValue(payload, "goodsReceiptId");
      case "procurement.invoice-approved" -> textValue(payload, "supplierInvoiceId");
      case "payroll.payroll-approved" -> textValue(payload, "payrollId");
      case "finance.expense-record-created" -> textValue(payload, "expenseRecordId");
      default -> null;
    };
  }

  private String textValue(JsonNode payload, String fieldName) {
    JsonNode node = payload.get(fieldName);
    if (node == null || node.isNull()) {
      return null;
    }
    return node.asText();
  }

  private String mapAction(String eventType) {
    return switch (eventType) {
      case "auth.user.created", "org.outlet.created", "org.region.created", "finance.expense-record-created" -> "insert";
      case "auth.role.updated", "auth.user-role-changed", "org.outlet.updated", "org.region.updated",
          "org.exchange_rate.updated", "product.price.changed", "product.recipe.updated",
          "inventory.stock.low-threshold" -> "update";
      case "procurement.invoice-approved", "payroll.payroll-approved" -> "approve";
      case "procurement.goods-receipt-posted", "sales.sale.completed", "sales.payment.captured" -> "post";
      default -> "update";
    };
  }

  private String mapEntityName(String eventType) {
    return switch (eventType) {
      case "auth.user.created" -> "app_user";
      case "auth.role.updated" -> "role";
      case "auth.user-role-changed" -> "user_role";
      case "org.outlet.created", "org.outlet.updated" -> "outlet";
      case "org.region.created", "org.region.updated" -> "region";
      case "org.exchange_rate.updated" -> "exchange_rate";
      case "product.price.changed" -> "product_price";
      case "product.recipe.updated" -> "recipe";
      case "sales.sale.completed" -> "sale_record";
      case "sales.payment.captured" -> "payment";
      case "procurement.goods-receipt-posted" -> "goods_receipt";
      case "procurement.invoice-approved" -> "supplier_invoice";
      case "payroll.payroll-approved" -> "payroll";
      case "finance.expense-record-created" -> "expense_record";
      case "inventory.stock.low-threshold" -> "stock_balance";
      default -> "event";
    };
  }

  @DltHandler
  public void handleDlt(String message, @Header(KafkaHeaders.ORIGINAL_TOPIC) String topic) {
    log.error("Audit DLT: topic={} payload={}", topic, message);
  }

  private String jsonBody(Map<String, Object> body) {
    try {
      return objectMapper.writeValueAsString(body);
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to serialize audit idempotency response", ex);
    }
  }

  private static String idempotencyKey(EventEnvelope<?> envelope) {
    return envelope.eventId() + ":" + envelope.aggregateId();
  }
}
