package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.stereotype.Component;

@Component
public class PromotionSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public PromotionSyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.PROMOTION && eventType == EventType.PROMOTION_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    long promotionId = PayloadJson.longValue(payload, "promotionId", Long.parseLong(event.aggregateId()));
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion (
            id, name, promo_type, status, value_amount, value_percent,
            effective_from, effective_to, created_at, updated_at
          ) VALUES (?, ?, ?::promo_type_enum, ?::promo_status_enum, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              promo_type = EXCLUDED.promo_type,
              status = EXCLUDED.status,
              value_amount = EXCLUDED.value_amount,
              value_percent = EXCLUDED.value_percent,
              effective_from = EXCLUDED.effective_from,
              effective_to = EXCLUDED.effective_to,
              updated_at = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, promotionId);
        ps.setString(2, PayloadJson.text(payload, "name", event.aggregateId()));
        ps.setString(3, normalizePromoType(PayloadJson.text(payload, "promoType", "fixed_amount")));
        ps.setString(4, normalizeStatus(PayloadJson.text(payload, "status", "active")));
        ps.setBigDecimal(5, PayloadJson.decimal(payload, "valueAmount", null));
        ps.setBigDecimal(6, PayloadJson.decimal(payload, "valuePercent", null));
        ps.setTimestamp(7, Timestamp.from(PayloadJson.instant(payload, "effectiveFrom", clock.instant())));
        java.time.Instant effectiveTo = PayloadJson.instant(payload, "effectiveTo", null);
        ps.setTimestamp(8, effectiveTo == null ? null : Timestamp.from(effectiveTo));
        ps.setTimestamp(9, now);
        ps.setTimestamp(10, now);
        ps.executeUpdate();
      }
      replaceScopes(conn, promotionId, payload.get("outletIds"));
      return null;
    });
  }

  private static void replaceScopes(java.sql.Connection conn, long promotionId, JsonNode outletIds)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("DELETE FROM core.promotion_scope WHERE promotion_id = ?")) {
      ps.setLong(1, promotionId);
      ps.executeUpdate();
    }
    if (outletIds == null || !outletIds.isArray()) {
      return;
    }
    for (JsonNode outlet : outletIds) {
      Long outletId = outlet.canConvertToLong() ? outlet.longValue() : null;
      if (outletId == null) {
        continue;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
          VALUES (?, ?, NOW())
          ON CONFLICT DO NOTHING
          """
      )) {
        ps.setLong(1, promotionId);
        ps.setLong(2, outletId);
        ps.executeUpdate();
      }
    }
  }

  private static String normalizePromoType(String promoType) {
    return switch (promoType == null ? "fixed_amount" : promoType.trim().toLowerCase().replace('-', '_')) {
      case "percentage", "buy_x_get_y", "combo_price", "subsidy" -> promoType.trim().toLowerCase().replace('-', '_');
      default -> "fixed_amount";
    };
  }

  private static String normalizeStatus(String status) {
    return switch (status == null ? "active" : status.trim().toLowerCase()) {
      case "draft", "inactive", "expired", "cancelled" -> status.trim().toLowerCase();
      default -> "active";
    };
  }
}
