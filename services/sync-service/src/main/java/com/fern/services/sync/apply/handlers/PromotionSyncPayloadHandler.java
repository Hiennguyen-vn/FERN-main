package com.fern.services.sync.apply.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.apply.PayloadJson;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.apply.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * Apply PROMOTION_UPDATED events at the store-edge.
 *
 * Upserts:
 *   1. core.promotion (header + lifecycle)
 *   2. core.promotion_scope (replace all outlets)
 *   3. One of core.promotion_bxgy_rule / promotion_combo_rule+items / promotion_subsidy_rule
 *      depending on promo_type; removes stale rules from other type tables to prevent
 *      incorrect mechanics surviving a type change.
 *
 * Idempotency: all upserts use ON CONFLICT, scopes + rules use DELETE + INSERT.
 * Version gate: delegates to SyncRepository.localVersionIsNewer().
 */
@Component
@Primary
public class PromotionSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;
  private final SyncRepository syncRepository;

  public PromotionSyncPayloadHandler(DataSource dataSource, Clock clock, SyncRepository syncRepository) {
    super(dataSource);
    this.clock = clock;
    this.syncRepository = syncRepository;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.PROMOTION && eventType == EventType.PROMOTION_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    long promotionId = PayloadJson.longValue(payload, "promotionId", Long.parseLong(event.aggregateId()));
    long incomingVersion = event.version();

    if (!syncRepository.localVersionIsNewer("PROMOTION", event.aggregateId(), incomingVersion)) {
      return;
    }

    String promoType = normalizePromoType(PayloadJson.text(payload, "promoType", "fixed_amount"));

    executeInTransaction(conn -> {
      // 1. Upsert promotion header
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
        ps.setString(3, promoType);
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

      // 2. Replace outlet scopes
      replaceScopes(conn, promotionId, payload.get("outletIds"));

      // 3. Apply typed rule – clear other type tables first to handle type transitions
      clearStaleRules(conn, promotionId, promoType);
      switch (promoType) {
        case "buy_x_get_y" -> applyBxgyRule(conn, promotionId, payload.get("bxgyRule"));
        case "combo_price"  -> applyComboRule(conn, promotionId, payload.get("comboRule"));
        case "subsidy"      -> applySubsidyRule(conn, promotionId, payload.get("subsidyRule"));
        default             -> { /* fixed_amount / percentage: no extra rule table */ }
      }

      return null;
    });

    syncRepository.recordAppliedVersion("PROMOTION", event.aggregateId(), incomingVersion);
  }

  // ── Scope ──────────────────────────────────────────────────────────────────

  private static void replaceScopes(java.sql.Connection conn, long promotionId, JsonNode outletIds)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "DELETE FROM core.promotion_scope WHERE promotion_id = ?")) {
      ps.setLong(1, promotionId);
      ps.executeUpdate();
    }
    if (outletIds == null || !outletIds.isArray()) return;
    for (JsonNode outlet : outletIds) {
      if (!outlet.canConvertToLong()) continue;
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
          VALUES (?, ?, NOW())
          ON CONFLICT DO NOTHING
          """
      )) {
        ps.setLong(1, promotionId);
        ps.setLong(2, outlet.longValue());
        ps.executeUpdate();
      }
    }
  }

  // ── Rule tables ────────────────────────────────────────────────────────────

  /**
   * Remove rule rows for the TWO types that don't match the current promo_type, so a type
   * change (e.g. bxgy → combo) doesn't leave orphaned mechanics behind.
   */
  private static void clearStaleRules(java.sql.Connection conn, long promotionId, String currentType)
      throws Exception {
    if (!"buy_x_get_y".equals(currentType)) {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.promotion_bxgy_rule WHERE promotion_id = ?")) {
        ps.setLong(1, promotionId); ps.executeUpdate();
      }
    }
    if (!"combo_price".equals(currentType)) {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.promotion_combo_rule WHERE promotion_id = ?")) {
        ps.setLong(1, promotionId); ps.executeUpdate();
      }
    }
    if (!"subsidy".equals(currentType)) {
      try (PreparedStatement ps = conn.prepareStatement(
          "DELETE FROM core.promotion_subsidy_rule WHERE promotion_id = ?")) {
        ps.setLong(1, promotionId); ps.executeUpdate();
      }
    }
  }

  private static void applyBxgyRule(java.sql.Connection conn, long promotionId, JsonNode rule)
      throws Exception {
    if (rule == null || rule.isNull()) return;
    long buyProductId  = rule.has("buyProductId")  ? rule.get("buyProductId").longValue()  : 0L;
    long getProductId  = rule.has("getProductId")  ? rule.get("getProductId").longValue()  : 0L;
    BigDecimal buyQty  = rule.has("buyQty")  ? new BigDecimal(rule.get("buyQty").asText("1"))  : BigDecimal.ONE;
    BigDecimal getQty  = rule.has("getQty")  ? new BigDecimal(rule.get("getQty").asText("1"))  : BigDecimal.ONE;
    BigDecimal getDisc = rule.has("getDiscountPercent")
        ? new BigDecimal(rule.get("getDiscountPercent").asText("100")) : new BigDecimal("100");
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_bxgy_rule (
          promotion_id, buy_product_id, buy_quantity, get_product_id, get_quantity, get_discount_percent,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON CONFLICT (promotion_id) DO UPDATE
        SET buy_product_id = EXCLUDED.buy_product_id,
            buy_quantity   = EXCLUDED.buy_quantity,
            get_product_id = EXCLUDED.get_product_id,
            get_quantity   = EXCLUDED.get_quantity,
            get_discount_percent = EXCLUDED.get_discount_percent,
            updated_at     = EXCLUDED.updated_at
        """
    )) {
      ps.setLong(1, promotionId);
      ps.setLong(2, buyProductId);
      ps.setBigDecimal(3, buyQty);
      ps.setLong(4, getProductId);
      ps.setBigDecimal(5, getQty);
      ps.setBigDecimal(6, getDisc);
      ps.executeUpdate();
    }
  }

  private static void applyComboRule(java.sql.Connection conn, long promotionId, JsonNode rule)
      throws Exception {
    if (rule == null || rule.isNull()) return;
    BigDecimal comboPrice = rule.has("comboPrice")
        ? new BigDecimal(rule.get("comboPrice").asText("0")) : BigDecimal.ZERO;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_combo_rule (promotion_id, combo_price, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
        ON CONFLICT (promotion_id) DO UPDATE
        SET combo_price = EXCLUDED.combo_price,
            updated_at  = EXCLUDED.updated_at
        """
    )) {
      ps.setLong(1, promotionId);
      ps.setBigDecimal(2, comboPrice);
      ps.executeUpdate();
    }
    // Replace combo items
    try (PreparedStatement del = conn.prepareStatement(
        "DELETE FROM core.promotion_combo_rule_item WHERE promotion_id = ?")) {
      del.setLong(1, promotionId); del.executeUpdate();
    }
    JsonNode items = rule.get("items");
    if (items != null && items.isArray()) {
      for (JsonNode item : items) {
        if (!item.has("productId")) continue;
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.promotion_combo_rule_item (promotion_id, product_id, quantity, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
            ON CONFLICT (promotion_id, product_id) DO UPDATE
            SET quantity   = EXCLUDED.quantity,
                updated_at = EXCLUDED.updated_at
            """
        )) {
          ps.setLong(1, promotionId);
          ps.setLong(2, item.get("productId").longValue());
          BigDecimal qty = item.has("quantity")
              ? new BigDecimal(item.get("quantity").asText("1")) : BigDecimal.ONE;
          ps.setBigDecimal(3, qty);
          ps.executeUpdate();
        }
      }
    }
  }

  private static void applySubsidyRule(java.sql.Connection conn, long promotionId, JsonNode rule)
      throws Exception {
    if (rule == null || rule.isNull()) return;
    Long scopeProductId = (rule.has("scopeProductId") && !rule.get("scopeProductId").isNull())
        ? rule.get("scopeProductId").longValue() : null;
    String fundingSource = rule.has("fundingSource") ? rule.get("fundingSource").asText("INTERNAL") : "INTERNAL";
    String fundingAccount = rule.has("fundingAccountCode") && !rule.get("fundingAccountCode").isNull()
        ? rule.get("fundingAccountCode").asText(null) : null;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_subsidy_rule (
          promotion_id, scope_product_id, funding_source, funding_account_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), NOW())
        ON CONFLICT (promotion_id) DO UPDATE
        SET scope_product_id     = EXCLUDED.scope_product_id,
            funding_source       = EXCLUDED.funding_source,
            funding_account_code = EXCLUDED.funding_account_code,
            updated_at           = EXCLUDED.updated_at
        """
    )) {
      ps.setLong(1, promotionId);
      if (scopeProductId == null) ps.setNull(2, java.sql.Types.BIGINT);
      else ps.setLong(2, scopeProductId);
      ps.setString(3, fundingSource);
      ps.setString(4, fundingAccount);
      ps.executeUpdate();
    }
  }

  // ── Normalizers ────────────────────────────────────────────────────────────

  private static String normalizePromoType(String promoType) {
    return switch (promoType == null ? "fixed_amount" : promoType.trim().toLowerCase().replace('-', '_')) {
      case "percentage", "buy_x_get_y", "combo_price", "subsidy" ->
          promoType.trim().toLowerCase().replace('-', '_');
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
