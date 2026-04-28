package com.fern.events.inventory;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OfflineInventoryMovementRecordedEvent(
    @JsonProperty("event_id")
    @JsonAlias({"eventId", "source_event_id", "sourceEventId"})
    String sourceEventId,
    @JsonProperty("idempotency_key")
    @JsonAlias({"idempotencyKey"})
    String idempotencyKey,
    @JsonProperty("movement_type")
    @JsonAlias({"movementType", "type"})
    String movementType,
    @JsonProperty("outlet_id")
    @JsonAlias({"outletId"})
    long outletId,
    @JsonProperty("device_id")
    @JsonAlias({"deviceId"})
    Long deviceId,
    @JsonProperty("pos_session_id")
    @JsonAlias({"posSessionId"})
    Long posSessionId,
    @JsonProperty("terminal_id")
    @JsonAlias({"terminalId", "register_code", "registerCode"})
    String terminalId,
    @JsonProperty("actor_user_id")
    @JsonAlias({"actorUserId"})
    Long actorUserId,
    @JsonProperty("actor_username")
    @JsonAlias({"actorUsername"})
    String actorUsername,
    @JsonProperty("item_id")
    @JsonAlias({"itemId"})
    long itemId,
    String sku,
    BigDecimal quantity,
    String unit,
    @JsonProperty("unit_cost")
    @JsonAlias({"unitCost"})
    BigDecimal unitCost,
    String reason,
    String note,
    @JsonProperty("business_date")
    @JsonAlias({"businessDate"})
    LocalDate businessDate,
    @JsonProperty("created_at_device")
    @JsonAlias({"createdAtDevice"})
    Instant createdAtDevice,
    String source,
    @JsonProperty("needs_review")
    @JsonAlias({"needsReview"})
    Boolean needsReview
) {
  public boolean reviewRequired() {
    return needsReview == null || needsReview;
  }
}
