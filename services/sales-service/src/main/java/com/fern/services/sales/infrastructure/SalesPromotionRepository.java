package com.fern.services.sales.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.common.sync.CentralSyncOutboxWriter;
import com.fern.common.sync.SyncPayloadSchemas;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.SalesDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

@Repository
public class SalesPromotionRepository extends BaseRepository {

  private static final Set<String> PROMOTION_SORT_KEYS =
      Set.of("effectiveFrom", "name", "status", "createdAt", "id");

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;
  private final CentralSyncOutboxWriter centralSyncOutboxWriter;

  @Autowired
  public SalesPromotionRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock,
      CentralSyncOutboxWriter centralSyncOutboxWriter
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
    this.centralSyncOutboxWriter = centralSyncOutboxWriter;
  }

  public SalesPromotionRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock
  ) {
    this(dataSource, snowflakeIdGenerator, clock, null);
  }

  public PagedResult<SalesDtos.PromotionView> listPromotions(
      Set<Long> outletIds,
      String status,
      Instant effectiveAt,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      String normalizedStatus = normalizePromotionStatusFilter(status);
      StringBuilder sql = new StringBuilder(
          """
          SELECT p.id, p.name, p.promo_type, p.status, p.value_amount, p.value_percent, p.effective_from, p.effective_to,
                 COUNT(*) OVER() AS total_count
          FROM core.promotion p
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendPromotionScope(sql, params, outletIds);
      if (normalizedStatus != null) {
        sql.append(" AND p.status = ?::promo_status_enum");
        params.add(normalizedStatus);
      }
      if (effectiveAt != null) {
        sql.append(" AND p.effective_from <= ?");
        params.add(Timestamp.from(effectiveAt));
        sql.append(" AND (p.effective_to IS NULL OR p.effective_to >= ?)");
        params.add(Timestamp.from(effectiveAt));
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               p.id::text ILIKE ?
               OR p.name ILIKE ?
               OR p.promo_type::text ILIKE ?
               OR p.status::text ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolvePromotionSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.PromotionView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPromotion(rs, conn));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public Optional<SalesDtos.PromotionView> findPromotion(long promotionId) {
    return executeInTransaction(conn -> findPromotion(conn, promotionId));
  }

  public SalesDtos.PromotionView createPromotion(SalesDtos.CreatePromotionRequest request) {
    return executeInTransaction(conn -> {
      long promotionId = snowflakeIdGenerator.generateId();
      Instant now = clock.instant();
      String normalizedPromoType = normalizePromotionType(request.promoType());
      String initialStatus = resolvePromotionStatusForCreate(request.effectiveFrom(), now);
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion (
            id, name, promo_type, status, value_amount, value_percent, min_order_amount,
            max_discount_amount, effective_from, effective_to, created_at, updated_at
          ) VALUES (?, ?, ?::promo_type_enum, ?::promo_status_enum, ?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, promotionId);
        ps.setString(2, request.name().trim());
        ps.setString(3, normalizedPromoType);
        ps.setString(4, initialStatus);
        ps.setBigDecimal(5, request.valueAmount());
        ps.setBigDecimal(6, request.valuePercent());
        ps.setBigDecimal(7, request.minOrderAmount());
        ps.setBigDecimal(8, request.maxDiscountAmount());
        ps.setTimestamp(9, Timestamp.from(request.effectiveFrom()));
        ps.setTimestamp(10, request.effectiveTo() == null ? null : Timestamp.from(request.effectiveTo()));
        ps.setTimestamp(11, Timestamp.from(now));
        ps.setTimestamp(12, Timestamp.from(now));
        ps.executeUpdate();
      }
      if (request.outletIds() != null) {
        for (Long outletId : request.outletIds()) {
          try (PreparedStatement ps = conn.prepareStatement(
              """
              INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
              VALUES (?, ?, ?)
              """
          )) {
            ps.setLong(1, promotionId);
            ps.setLong(2, outletId);
            ps.setTimestamp(3, Timestamp.from(now));
            ps.executeUpdate();
          }
        }
      }
      replacePromotionRules(conn, promotionId, normalizedPromoType,
          request.bxgyRule(), request.comboRule(), request.subsidyRule(), now);
      SalesDtos.PromotionView promotion = findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Created promotion not found"));
      appendPromotionSyncEvents(conn, promotion, now);
      return promotion;
    });
  }

  public SalesDtos.PromotionView updatePromotionStatus(long promotionId, String status) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.promotion
          SET status = ?::promo_status_enum,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        ps.setString(1, status);
        ps.setLong(2, promotionId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Promotion not found: " + promotionId);
        }
      }
      SalesDtos.PromotionView promotion = findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Promotion not found after status update"));
      appendPromotionSyncEvents(conn, promotion, clock.instant());
      return promotion;
    });
  }

  public SalesDtos.PromotionView updatePromotion(long promotionId, SalesDtos.UpdatePromotionRequest request) {
    return executeInTransaction(conn -> {
      Instant now = clock.instant();
      StringBuilder sql = new StringBuilder("UPDATE core.promotion SET updated_at = ?");
      List<Object> params = new ArrayList<>();
      params.add(Timestamp.from(now));
      if (request.name() != null) {
        sql.append(", name = ?");
        params.add(request.name().trim());
      }
      if (request.promoType() != null) {
        sql.append(", promo_type = ?::promo_type_enum");
        params.add(normalizePromotionType(request.promoType()));
      }
      if (request.valueAmount() != null) {
        sql.append(", value_amount = ?");
        params.add(request.valueAmount());
      }
      if (request.valuePercent() != null) {
        sql.append(", value_percent = ?");
        params.add(request.valuePercent());
      }
      if (request.minOrderAmount() != null) {
        sql.append(", min_order_amount = ?");
        params.add(request.minOrderAmount());
      }
      if (request.maxDiscountAmount() != null) {
        sql.append(", max_discount_amount = ?");
        params.add(request.maxDiscountAmount());
      }
      if (request.effectiveFrom() != null) {
        sql.append(", effective_from = ?");
        params.add(Timestamp.from(request.effectiveFrom()));
      }
      if (request.effectiveTo() != null) {
        sql.append(", effective_to = ?");
        params.add(Timestamp.from(request.effectiveTo()));
      }
      if (request.status() != null) {
        sql.append(", status = ?::promo_status_enum");
        params.add(request.status().trim());
      }
      sql.append(" WHERE id = ?");
      params.add(promotionId);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        int updated = ps.executeUpdate();
        if (updated == 0) {
          throw ServiceException.notFound("Promotion not found: " + promotionId);
        }
      }
      if (request.outletIds() != null) {
        try (PreparedStatement ps = conn.prepareStatement(
            "DELETE FROM core.promotion_scope WHERE promotion_id = ?"
        )) {
          ps.setLong(1, promotionId);
          ps.executeUpdate();
        }
        for (Long outletId : request.outletIds()) {
          try (PreparedStatement ps = conn.prepareStatement(
              """
              INSERT INTO core.promotion_scope (promotion_id, outlet_id, created_at)
              VALUES (?, ?, ?)
              """
          )) {
            ps.setLong(1, promotionId);
            ps.setLong(2, outletId);
            ps.setTimestamp(3, Timestamp.from(now));
            ps.executeUpdate();
          }
        }
      }
      if (request.bxgyRule() != null || request.comboRule() != null || request.subsidyRule() != null) {
        String effectiveType = request.promoType() == null
            ? currentPromotionType(conn, promotionId)
            : normalizePromotionType(request.promoType());
        replacePromotionRules(conn, promotionId, effectiveType,
            request.bxgyRule(), request.comboRule(), request.subsidyRule(), now);
      } else if (request.promoType() != null) {
        clearPromotionRules(conn, promotionId);
      }
      SalesDtos.PromotionView promotion = findPromotion(conn, promotionId)
          .orElseThrow(() -> new IllegalStateException("Promotion not found after update"));
      appendPromotionSyncEvents(conn, promotion, now);
      return promotion;
    });
  }

  private void appendPromotionSyncEvents(
      Connection conn,
      SalesDtos.PromotionView promotion,
      Instant updatedAt
  ) {
    if (centralSyncOutboxWriter == null) {
      return;
    }
    String aggregateId = promotion.id();
    long version = centralSyncOutboxWriter.nextVersion(conn, "PROMOTION", aggregateId);
    SyncPayloadSchemas.PromotionPayload payload = new SyncPayloadSchemas.PromotionPayload(
        Long.parseLong(promotion.id()),
        promotion.name(),
        promotion.promoType(),
        promotion.status(),
        promotion.valueAmount(),
        promotion.valuePercent(),
        promotion.effectiveFrom(),
        promotion.effectiveTo(),
        promotion.outletIds(),
        promotion.bxgyRule(),
        promotion.comboRule(),
        promotion.subsidyRule(),
        version,
        updatedAt
    );
    if (promotion.outletIds() == null || promotion.outletIds().isEmpty()) {
      centralSyncOutboxWriter.append(
          conn, "PROMOTION_UPDATED", "PROMOTION", aggregateId,
          "ALL_STORES", null, null, payload, version);
      return;
    }
    for (Long outletId : promotion.outletIds()) {
      centralSyncOutboxWriter.append(
          conn, "PROMOTION_UPDATED", "PROMOTION", aggregateId,
          "STORE", outletId, null, payload, version);
    }
  }

  public List<ActivePromotionRow> findActivePromotionsForOutlet(long outletId, Instant now) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT p.id, p.name, p.promo_type::text AS promo_type,
                 p.value_amount, p.value_percent,
                 p.min_order_amount, p.max_discount_amount,
                 p.effective_from, p.effective_to
          FROM core.promotion p
          WHERE p.status = 'active'::promo_status_enum
            AND p.effective_from <= ?
            AND (p.effective_to IS NULL OR p.effective_to >= ?)
            AND (
              NOT EXISTS (SELECT 1 FROM core.promotion_scope ps WHERE ps.promotion_id = p.id)
              OR EXISTS (SELECT 1 FROM core.promotion_scope ps WHERE ps.promotion_id = p.id AND ps.outlet_id = ?)
            )
          """
      )) {
        ps.setTimestamp(1, Timestamp.from(now));
        ps.setTimestamp(2, Timestamp.from(now));
        ps.setLong(3, outletId);
        try (ResultSet rs = ps.executeQuery()) {
          List<ActivePromotionRow> rows = new ArrayList<>();
          while (rs.next()) {
            rows.add(new ActivePromotionRow(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("promo_type"),
                rs.getBigDecimal("value_amount"),
                rs.getBigDecimal("value_percent"),
                rs.getBigDecimal("min_order_amount"),
                rs.getBigDecimal("max_discount_amount")
            ));
          }
          return rows;
        }
      }
    });
  }

  public Optional<BxgyRule> findBxgyRule(long promotionId) {
    return executeInTransaction(conn -> findBxgyRule(conn, promotionId));
  }

  public Optional<ComboRule> findComboRule(long promotionId) {
    return executeInTransaction(conn -> findComboRule(conn, promotionId));
  }

  public Optional<SubsidyRule> findSubsidyRule(long promotionId) {
    return executeInTransaction(conn -> findSubsidyRule(conn, promotionId));
  }

  private String resolvePromotionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PROMOTION_SORT_KEYS, "effectiveFrom");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "name" -> "p.name " + direction + ", p.id " + direction;
      case "status" -> "p.status " + direction + ", p.effective_from DESC, p.id DESC";
      case "createdAt" -> "p.created_at " + direction + ", p.id " + direction;
      case "id" -> "p.id " + direction;
      case "effectiveFrom" -> "p.effective_from " + direction + ", p.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported promotion sort key");
    };
  }

  private Optional<SalesDtos.PromotionView> findPromotion(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, name, promo_type, status, value_amount, value_percent, effective_from, effective_to
        FROM core.promotion
        WHERE id = ?
        """
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPromotion(rs, conn));
        }
        return Optional.empty();
      }
    }
  }

  private SalesDtos.PromotionView mapPromotion(ResultSet rs, Connection conn) throws Exception {
    long promotionId = rs.getLong("id");
    return new SalesDtos.PromotionView(
        Long.toString(promotionId),
        rs.getString("name"),
        rs.getString("promo_type"),
        rs.getString("status"),
        rs.getBigDecimal("value_amount"),
        rs.getBigDecimal("value_percent"),
        rs.getTimestamp("effective_from").toInstant(),
        rs.getTimestamp("effective_to") == null ? null : rs.getTimestamp("effective_to").toInstant(),
        loadPromotionScopes(conn, promotionId),
        findBxgyRule(conn, promotionId).map(this::toDto).orElse(null),
        findComboRule(conn, promotionId).map(this::toDto).orElse(null),
        findSubsidyRule(conn, promotionId).map(this::toDto).orElse(null)
    );
  }

  private String currentPromotionType(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT promo_type::text FROM core.promotion WHERE id = ?"
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("Promotion not found: " + promotionId);
        }
        return rs.getString(1);
      }
    }
  }

  private void replacePromotionRules(
      Connection conn,
      long promotionId,
      String promoType,
      SalesDtos.PromotionBxgyRule bxgyRule,
      SalesDtos.PromotionComboRule comboRule,
      SalesDtos.PromotionSubsidyRule subsidyRule,
      Instant now
  ) throws Exception {
    clearPromotionRules(conn, promotionId);
    switch (promoType) {
      case "buy_x_get_y" -> {
        if (bxgyRule != null) {
          insertBxgyRule(conn, promotionId, bxgyRule, now);
        }
      }
      case "combo_price" -> {
        if (comboRule != null) {
          insertComboRule(conn, promotionId, comboRule, now);
        }
      }
      case "subsidy" -> {
        if (subsidyRule != null) {
          insertSubsidyRule(conn, promotionId, subsidyRule, now);
        }
      }
      default -> {
      }
    }
  }

  private void clearPromotionRules(Connection conn, long promotionId) throws Exception {
    for (String table : List.of(
        "core.promotion_bxgy_rule",
        "core.promotion_combo_rule",
        "core.promotion_subsidy_rule")) {
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM " + table + " WHERE promotion_id = ?")) {
        ps.setLong(1, promotionId);
        ps.executeUpdate();
      }
    }
  }

  private void insertBxgyRule(
      Connection conn,
      long promotionId,
      SalesDtos.PromotionBxgyRule rule,
      Instant now
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_bxgy_rule (
          promotion_id, buy_product_id, buy_quantity, get_product_id, get_quantity,
          get_discount_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, promotionId);
      ps.setLong(2, rule.buyProductId());
      ps.setBigDecimal(3, rule.buyQuantity());
      ps.setLong(4, rule.getProductId());
      ps.setBigDecimal(5, rule.getQuantity());
      ps.setBigDecimal(6, rule.getDiscountPercent());
      ps.setTimestamp(7, Timestamp.from(now));
      ps.setTimestamp(8, Timestamp.from(now));
      ps.executeUpdate();
    }
  }

  private void insertComboRule(
      Connection conn,
      long promotionId,
      SalesDtos.PromotionComboRule rule,
      Instant now
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_combo_rule (promotion_id, combo_price, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, promotionId);
      ps.setBigDecimal(2, rule.comboPrice());
      ps.setTimestamp(3, Timestamp.from(now));
      ps.setTimestamp(4, Timestamp.from(now));
      ps.executeUpdate();
    }
    for (SalesDtos.PromotionComboRuleItem item : rule.items()) {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.promotion_combo_rule_item (
            promotion_id, product_id, quantity, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, promotionId);
        ps.setLong(2, item.productId());
        ps.setBigDecimal(3, item.quantity());
        ps.setTimestamp(4, Timestamp.from(now));
        ps.setTimestamp(5, Timestamp.from(now));
        ps.executeUpdate();
      }
    }
  }

  private void insertSubsidyRule(
      Connection conn,
      long promotionId,
      SalesDtos.PromotionSubsidyRule rule,
      Instant now
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.promotion_subsidy_rule (
          promotion_id, scope_product_id, funding_source, funding_account_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, promotionId);
      if (rule.scopeProductId() == null) {
        ps.setNull(2, Types.BIGINT);
      } else {
        ps.setLong(2, rule.scopeProductId());
      }
      ps.setString(3, rule.fundingSource());
      ps.setString(4, rule.fundingAccountCode());
      ps.setTimestamp(5, Timestamp.from(now));
      ps.setTimestamp(6, Timestamp.from(now));
      ps.executeUpdate();
    }
  }

  private Set<Long> loadPromotionScopes(Connection conn, long promotionId) throws Exception {
    Set<Long> outletIds = new LinkedHashSet<>();
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT outlet_id FROM core.promotion_scope WHERE promotion_id = ? ORDER BY outlet_id"
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          outletIds.add(rs.getLong("outlet_id"));
        }
      }
    }
    return Set.copyOf(outletIds);
  }

  private Optional<BxgyRule> findBxgyRule(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT promotion_id, buy_product_id, buy_quantity, get_product_id, get_quantity, get_discount_percent
        FROM core.promotion_bxgy_rule
        WHERE promotion_id = ?
        """
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new BxgyRule(
            rs.getLong("promotion_id"),
            rs.getLong("buy_product_id"),
            rs.getBigDecimal("buy_quantity"),
            rs.getLong("get_product_id"),
            rs.getBigDecimal("get_quantity"),
            rs.getBigDecimal("get_discount_percent")
        ));
      }
    }
  }

  private Optional<ComboRule> findComboRule(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT promotion_id, combo_price
        FROM core.promotion_combo_rule
        WHERE promotion_id = ?
        """
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        BigDecimal comboPrice = rs.getBigDecimal("combo_price");
        List<ComboRuleItem> items = new ArrayList<>();
        try (PreparedStatement itemPs = conn.prepareStatement(
            """
            SELECT product_id, quantity
            FROM core.promotion_combo_rule_item
            WHERE promotion_id = ?
            ORDER BY product_id
            """
        )) {
          itemPs.setLong(1, promotionId);
          try (ResultSet itemRs = itemPs.executeQuery()) {
            while (itemRs.next()) {
              items.add(new ComboRuleItem(itemRs.getLong("product_id"), itemRs.getBigDecimal("quantity")));
            }
          }
        }
        return Optional.of(new ComboRule(promotionId, comboPrice, items));
      }
    }
  }

  private Optional<SubsidyRule> findSubsidyRule(Connection conn, long promotionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT promotion_id, scope_product_id, funding_source, funding_account_code
        FROM core.promotion_subsidy_rule
        WHERE promotion_id = ?
        """
    )) {
      ps.setLong(1, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Object scopeProductId = rs.getObject("scope_product_id");
        return Optional.of(new SubsidyRule(
            rs.getLong("promotion_id"),
            scopeProductId == null ? null : ((Number) scopeProductId).longValue(),
            rs.getString("funding_source"),
            rs.getString("funding_account_code")
        ));
      }
    }
  }

  private SalesDtos.PromotionBxgyRule toDto(BxgyRule rule) {
    return new SalesDtos.PromotionBxgyRule(
        rule.buyProductId(),
        rule.buyQuantity(),
        rule.getProductId(),
        rule.getQuantity(),
        rule.getDiscountPercent());
  }

  private SalesDtos.PromotionComboRule toDto(ComboRule rule) {
    return new SalesDtos.PromotionComboRule(
        rule.comboPrice(),
        rule.items().stream()
            .map(item -> new SalesDtos.PromotionComboRuleItem(item.productId(), item.quantity()))
            .toList());
  }

  private SalesDtos.PromotionSubsidyRule toDto(SubsidyRule rule) {
    return new SalesDtos.PromotionSubsidyRule(
        rule.scopeProductId(),
        rule.fundingSource(),
        rule.fundingAccountCode());
  }

  private static String normalizePromotionType(String promoType) {
    if (promoType == null || promoType.isBlank()) {
      throw ServiceException.badRequest("promoType is required");
    }
    String normalized = promoType.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    return switch (normalized) {
      case "percentage", "percent", "discount_percent" -> "percentage";
      case "fixed_amount", "fixed", "amount", "discount_fixed" -> "fixed_amount";
      case "buy_x_get_y", "bogo" -> "buy_x_get_y";
      case "combo_price", "combo" -> "combo_price";
      case "subsidy" -> "subsidy";
      default -> throw ServiceException.badRequest("Unsupported promoType: " + promoType);
    };
  }

  private static String resolvePromotionStatusForCreate(Instant effectiveFrom, Instant now) {
    return effectiveFrom != null && effectiveFrom.isAfter(now) ? "draft" : "active";
  }

  private static String normalizePromotionStatusFilter(String status) {
    if (status == null || status.isBlank()) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    return switch (normalized) {
      case "all" -> null;
      case "active" -> "active";
      case "inactive", "paused" -> "inactive";
      case "draft", "scheduled" -> "draft";
      case "expired" -> "expired";
      case "cancelled" -> "cancelled";
      default -> throw ServiceException.badRequest("Unsupported promotion status filter: " + status);
    };
  }

  private void appendPromotionScope(
      StringBuilder sql,
      List<Object> params,
      Set<Long> outletIds
  ) {
    if (outletIds == null) {
      return;
    }
    if (outletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND EXISTS (SELECT 1 FROM core.promotion_scope ps WHERE ps.promotion_id = p.id AND ps.outlet_id = ANY (?::bigint[]))");
    params.add(new LongArrayParam(outletIds.stream().mapToLong(Long::longValue).toArray()));
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws Exception {
    for (int i = 0; i < params.size(); i++) {
      Object value = params.get(i);
      if (value instanceof LongArrayParam longArray) {
        Long[] boxed = java.util.Arrays.stream(longArray.values()).boxed().toArray(Long[]::new);
        ps.setArray(i + 1, ps.getConnection().createArrayOf("bigint", boxed));
      } else if (value instanceof Long longValue) {
        ps.setLong(i + 1, longValue);
      } else if (value instanceof Integer integerValue) {
        ps.setInt(i + 1, integerValue);
      } else if (value instanceof String stringValue) {
        ps.setString(i + 1, stringValue);
      } else if (value instanceof Timestamp timestamp) {
        ps.setTimestamp(i + 1, timestamp);
      } else if (value instanceof LocalDate localDate) {
        ps.setObject(i + 1, localDate);
      } else {
        ps.setObject(i + 1, value);
      }
    }
  }

  public record ActivePromotionRow(
      long id,
      String name,
      String promoType,
      BigDecimal valueAmount,
      BigDecimal valuePercent,
      BigDecimal minOrderAmount,
      BigDecimal maxDiscountAmount
  ) {
  }

  public record BxgyRule(
      long promotionId,
      long buyProductId,
      BigDecimal buyQuantity,
      long getProductId,
      BigDecimal getQuantity,
      BigDecimal getDiscountPercent
  ) {
  }

  public record ComboRule(
      long promotionId,
      BigDecimal comboPrice,
      List<ComboRuleItem> items
  ) {
  }

  public record ComboRuleItem(
      long productId,
      BigDecimal quantity
  ) {
  }

  public record SubsidyRule(
      long promotionId,
      Long scopeProductId,
      String fundingSource,
      String fundingAccountCode
  ) {
  }

  private record LongArrayParam(long[] values) {
  }
}
