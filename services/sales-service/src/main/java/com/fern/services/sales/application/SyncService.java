package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.outbox.OutboxWriter;
import com.dorabets.common.repository.BaseRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sales.api.SyncDtos;
import com.fern.services.sales.api.SyncDtos.CatalogRow;
import com.fern.services.sales.api.SyncDtos.RecipeComponentRow;
import com.fern.services.sales.api.SyncDtos.RecipeRow;
import com.fern.services.sales.api.SyncDtos.StockRow;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import javax.sql.DataSource;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class SyncService extends BaseRepository {

    private final SalesService salesService;
    private final PosMetrics posMetrics;
    private final SnowflakeIdGenerator snowflake;
    private final ObjectMapper objectMapper;
    private final OutboxWriter outboxWriter;

    public SyncService(
        DataSource dataSource,
        SalesService salesService,
        PosMetrics posMetrics,
        SnowflakeIdGenerator snowflake,
        ObjectMapper objectMapper,
        OutboxWriter outboxWriter
    ) {
        super(dataSource);
        this.salesService = salesService;
        this.posMetrics = posMetrics;
        this.snowflake = snowflake;
        this.objectMapper = objectMapper;
        this.outboxWriter = outboxWriter;
    }

    // ── Catalog pull ──────────────────────────────────────────────────────────

    /**
     * Returns catalog rows updated since {@code sinceEpochMs} for the given outlet.
     * sinceEpochMs = 0 returns full catalog.
     */
    public List<CatalogRow> pullCatalog(long outletId, long sinceEpochMs, int limit) {
        // product_category PK is `code` (varchar). Project a stable numeric id via hashtext
        // so the DTO keeps `categoryId long` without a schema change.
        String sql = """
            SELECT
              p.id                          AS product_id,
              p.name                        AS product_name,
              abs(hashtext(pc.code))::bigint AS category_id,
              pc.name                       AS category_name,
              COALESCE(poa.is_available, true) AS is_available,
              COALESCE(
                ROUND(pp.price_value)::bigint,
                0
              )                             AS price_cents,
              COALESCE(
                ROUND(tr.tax_percent * 100)::bigint,
                0
              )                             AS tax_basis_points,
              EXTRACT(EPOCH FROM GREATEST(
                p.updated_at,
                COALESCE(poa.updated_at, p.updated_at),
                COALESCE(pp.updated_at, p.updated_at),
                COALESCE(tr.updated_at, p.updated_at)
              )) * 1000 AS updated_at_ms
            FROM core.product p
            JOIN core.product_category pc ON p.category_code = pc.code
            JOIN core.outlet o ON o.id = ?
            LEFT JOIN core.product_outlet_availability poa
                   ON poa.product_id = p.id AND poa.outlet_id = ?
            LEFT JOIN LATERAL (
              SELECT price_value, updated_at
              FROM core.product_price pp
              WHERE pp.product_id = p.id
                AND pp.outlet_id = ?
                AND pp.effective_from <= CURRENT_DATE
                AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
              ORDER BY pp.effective_from DESC, pp.updated_at DESC
              LIMIT 1
            ) pp ON TRUE
            LEFT JOIN LATERAL (
              SELECT tax_percent
                   , updated_at
              FROM core.tax_rate tr
              WHERE tr.product_id = p.id
                AND tr.region_id = o.region_id
                AND tr.effective_from <= CURRENT_DATE
                AND (tr.effective_to IS NULL OR tr.effective_to >= CURRENT_DATE)
              ORDER BY tr.effective_from DESC, tr.updated_at DESC
              LIMIT 1
            ) tr ON TRUE
            WHERE p.status = 'active'
              AND EXTRACT(EPOCH FROM GREATEST(
                p.updated_at,
                COALESCE(poa.updated_at, p.updated_at),
                COALESCE(pp.updated_at, p.updated_at),
                COALESCE(tr.updated_at, p.updated_at)
              )) * 1000 > ?
            ORDER BY updated_at_ms ASC, p.id ASC
            LIMIT ?
            """;
        return executeInTransaction(conn -> {
            List<CatalogRow> rows = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, outletId);
                ps.setLong(2, outletId);
                ps.setLong(3, outletId);
                ps.setLong(4, sinceEpochMs);
                ps.setInt(5, limit);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        rows.add(new CatalogRow(
                            rs.getLong("product_id"),
                            outletId,
                            rs.getString("product_name"),
                            rs.getLong("category_id"),
                            rs.getString("category_name"),
                            rs.getBoolean("is_available"),
                            rs.getLong("price_cents"),
                            rs.getLong("tax_basis_points"),
                            rs.getLong("updated_at_ms")
                        ));
                    }
                }
            }
            return rows;
        });
    }

    // ── Stock pull ────────────────────────────────────────────────────────────

    public List<StockRow> pullStock(long outletId) {
        // core.stock_balance PK is (location_id, item_id); location_id === outlet_id here.
        String sql = """
            SELECT
              sb.item_id,
              sb.location_id AS outlet_id,
              sb.qty_on_hand::text,
              COALESCE(
                EXTRACT(EPOCH FROM MAX(it.txn_time)) * 1000,
                0
              )::bigint AS last_movement_ms
            FROM core.stock_balance sb
            LEFT JOIN core.inventory_transaction it
                   ON it.item_id = sb.item_id AND it.outlet_id = sb.location_id
            WHERE sb.location_id = ?
            GROUP BY sb.item_id, sb.location_id, sb.qty_on_hand
            ORDER BY sb.item_id
            """;
        return executeInTransaction(conn -> {
            List<StockRow> rows = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, outletId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        rows.add(new StockRow(
                            rs.getLong("item_id"),
                            outletId,
                            rs.getString("qty_on_hand"),
                            rs.getLong("last_movement_ms")
                        ));
                    }
                }
            }
            return rows;
        });
    }

    public SyncDtos.MenuSnapshot pullMenu(long outletId) {
        String productSql = """
            SELECT
              p.id,
              ? AS outlet_id,
              p.code,
              p.name,
              abs(hashtext(pc.code))::bigint AS category_id,
              pc.name AS category_name,
              (p.status = 'active') AS is_active,
              COALESCE(poa.is_available, true) AS is_available,
              COALESCE(ROUND(pp.price_value)::bigint, 0) AS price_cents,
              COALESCE(ROUND(tr.tax_percent * 100)::bigint, 0) AS tax_basis_points
            FROM core.product p
            JOIN core.product_category pc ON p.category_code = pc.code
            LEFT JOIN core.product_outlet_availability poa
                   ON poa.product_id = p.id AND poa.outlet_id = ?
            LEFT JOIN LATERAL (
              SELECT price_value
              FROM core.product_price pp
              WHERE pp.product_id = p.id
                AND pp.outlet_id = ?
                AND pp.effective_from <= CURRENT_DATE
                AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
              ORDER BY pp.effective_from DESC, pp.updated_at DESC
              LIMIT 1
            ) pp ON TRUE
            LEFT JOIN core.outlet o ON o.id = ?
            LEFT JOIN LATERAL (
              SELECT tax_percent
              FROM core.tax_rate tr
              WHERE tr.product_id = p.id
                AND tr.region_id = o.region_id
                AND tr.effective_from <= CURRENT_DATE
                AND (tr.effective_to IS NULL OR tr.effective_to >= CURRENT_DATE)
              ORDER BY tr.effective_from DESC, tr.updated_at DESC
              LIMIT 1
            ) tr ON TRUE
            ORDER BY COALESCE(pc.display_order, 0), p.name, p.id
            """;
        String variantSql = """
            SELECT pv.id, pv.product_id, pv.code, pv.name, pv.price_modifier_type,
                   pv.price_modifier_value::text, pv.display_order, pv.is_active
            FROM core.product_variant pv
            ORDER BY pv.product_id, pv.display_order, pv.id
            """;
        String modifierGroupSql = """
            SELECT mg.id, mg.code, mg.name, mg.selection_type, mg.min_selections,
                   mg.max_selections, 0 AS display_order, mg.is_active
            FROM core.modifier_group mg
            ORDER BY mg.name, mg.id
            """;
        String modifierOptionSql = """
            SELECT mo.id, mo.modifier_group_id, mo.code, mo.name, mo.price_adjustment::text,
                   mo.display_order, mo.is_active
            FROM core.modifier_option mo
            ORDER BY mo.modifier_group_id, mo.display_order, mo.id
            """;
        String productModifierGroupSql = """
            SELECT pmg.product_id, pmg.modifier_group_id, pmg.is_required, pmg.display_order
            FROM core.product_modifier_group pmg
            ORDER BY pmg.product_id, pmg.display_order, pmg.modifier_group_id
            """;
        return executeInTransaction(conn -> {
            List<SyncDtos.MenuProductRow> products = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(productSql)) {
                ps.setLong(1, outletId);
                ps.setLong(2, outletId);
                ps.setLong(3, outletId);
                ps.setLong(4, outletId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        products.add(new SyncDtos.MenuProductRow(
                            rs.getLong("id"),
                            outletId,
                            rs.getString("code"),
                            rs.getString("name"),
                            rs.getLong("category_id"),
                            rs.getString("category_name"),
                            rs.getBoolean("is_active"),
                            rs.getBoolean("is_available"),
                            rs.getLong("price_cents"),
                            rs.getLong("tax_basis_points")
                        ));
                    }
                }
            }
            List<SyncDtos.MenuVariantRow> variants = queryRows(conn, variantSql, rs -> new SyncDtos.MenuVariantRow(
                rs.getLong("id"),
                rs.getLong("product_id"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("price_modifier_type"),
                rs.getString("price_modifier_value"),
                rs.getInt("display_order"),
                rs.getBoolean("is_active")
            ));
            List<SyncDtos.MenuModifierGroupRow> modifierGroups = queryRows(conn, modifierGroupSql, rs -> new SyncDtos.MenuModifierGroupRow(
                rs.getLong("id"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("selection_type"),
                rs.getInt("min_selections"),
                rs.getInt("max_selections"),
                rs.getInt("display_order"),
                rs.getBoolean("is_active")
            ));
            List<SyncDtos.MenuModifierOptionRow> modifierOptions = queryRows(conn, modifierOptionSql, rs -> new SyncDtos.MenuModifierOptionRow(
                rs.getLong("id"),
                rs.getLong("modifier_group_id"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("price_adjustment"),
                rs.getInt("display_order"),
                rs.getBoolean("is_active")
            ));
            List<SyncDtos.MenuProductModifierGroupRow> productModifierGroups = queryRows(conn, productModifierGroupSql, rs -> new SyncDtos.MenuProductModifierGroupRow(
                rs.getLong("product_id"),
                rs.getLong("modifier_group_id"),
                rs.getBoolean("is_required"),
                rs.getInt("display_order")
            ));
            long version = computeMenuVersion(conn);
            return new SyncDtos.MenuSnapshot(outletId, version, products, variants, modifierGroups, modifierOptions, productModifierGroups);
        });
    }

    // ── Recipe pull ───────────────────────────────────────────────────────────

    public List<RecipeRow> pullRecipes(long outletId, long sinceEpochMs, int limit) {
        String sql = """
            WITH ranked_recipe AS (
              SELECT
                r.product_id,
                r.version,
                r.yield_qty,
                r.yield_uom_code,
                r.status,
                r.updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY r.product_id
                  ORDER BY r.updated_at DESC, r.created_at DESC, r.version DESC
                ) AS rn
              FROM core.recipe r
              JOIN core.product p ON p.id = r.product_id
              JOIN core.product_outlet_availability poa
                ON poa.product_id = p.id
               AND poa.outlet_id = ?
               AND poa.is_available = TRUE
              WHERE p.status = 'active'
            )
            SELECT
              product_id,
              version,
              yield_qty,
              yield_uom_code,
              status::text AS status,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_at_ms
            FROM ranked_recipe
            WHERE rn = 1
              AND (EXTRACT(EPOCH FROM updated_at) * 1000) > ?
            ORDER BY updated_at ASC, product_id ASC
            LIMIT ?
            """;
        return executeInTransaction(conn -> {
            List<RecipeRow> rows = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, outletId);
                ps.setLong(2, sinceEpochMs);
                ps.setInt(3, limit);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        long productId = rs.getLong("product_id");
                        String version = rs.getString("version");
                        rows.add(new RecipeRow(
                            productId,
                            version,
                            toPlainString(rs.getBigDecimal("yield_qty")),
                            rs.getString("yield_uom_code"),
                            rs.getString("status"),
                            rs.getLong("updated_at_ms"),
                            loadRecipeComponents(conn, productId, version)
                        ));
                    }
                }
            }
            return rows;
        });
    }

    // ── Tax rules pull ────────────────────────────────────────────────────────

    public List<SyncDtos.TaxRuleRow> pullTaxRules(long outletId) {
        String sql = """
            SELECT id, outlet_id, product_category_code, rate_pct, inclusive,
                   effective_from, effective_to
            FROM core.tax_rule
            WHERE outlet_id = ?
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
            ORDER BY effective_from DESC, id ASC
            """;
        return executeInTransaction(conn -> {
            List<SyncDtos.TaxRuleRow> rows = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, outletId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        rows.add(new SyncDtos.TaxRuleRow(
                            rs.getLong("id"),
                            rs.getLong("outlet_id"),
                            rs.getString("product_category_code"),
                            rs.getBigDecimal("rate_pct"),
                            rs.getBoolean("inclusive"),
                            rs.getDate("effective_from").toLocalDate(),
                            rs.getDate("effective_to") != null
                                ? rs.getDate("effective_to").toLocalDate() : null
                        ));
                    }
                }
            }
            return rows;
        });
    }

    // ── Manifest ──────────────────────────────────────────────────────────────

    public SyncDtos.ManifestResponse manifest() {
        // Catalog version = max updated_at epoch ms across products
        // Price version   = max updated_at epoch ms across product_prices
        // Stock version   = max txn_time epoch ms across inventory_transactions
        // NOTE: Each version is computed independently to avoid cross-product scans.
        String sql = """
            SELECT
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product), 0)               AS catalog_version,
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product_price), 0)         AS price_version,
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM txn_time) * 1000)::bigint   FROM core.inventory_transaction), 0) AS stock_version,
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.recipe), 0)               AS recipe_version,
              GREATEST(
                COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product), 0),
                COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product_price), 0),
                COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product_variant), 0),
                COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.modifier_group), 0),
                COALESCE((SELECT MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint FROM core.modifier_option), 0)
              ) AS menu_version
            """;
        return executeInTransaction(conn -> {
            try (PreparedStatement ps = conn.prepareStatement(sql);
                 ResultSet rs = ps.executeQuery()) {
                rs.next();
                return new SyncDtos.ManifestResponse(
                    rs.getLong("catalog_version"),
                    rs.getLong("price_version"),
                    rs.getLong("stock_version"),
                    rs.getLong("recipe_version"),
                    rs.getLong("menu_version"),
                    Instant.now().toString()
                );
            }
        });
    }

    // ── Push event routing ────────────────────────────────────────────────────

    public SyncDtos.PushResponse push(SyncDtos.PushRequest request, DeviceService deviceService) {
        if (request.events() == null || request.events().isEmpty()) {
            return new SyncDtos.PushResponse(List.of(), List.of());
        }
        long requestDeviceId = toLong(request.deviceId());

        // S3: validate device-JWT outlet binding
        RequestUserContext ctx = RequestUserContextHolder.get();
        if (ctx.isDeviceContext()) {
            long claimedOutletId = ctx.deviceOutletId();
            for (SyncDtos.PushEvent event : request.events()) {
                long payloadOutletId = extractOutletId(event.payload());
                if (payloadOutletId != 0 && payloadOutletId != claimedOutletId) {
                    throw ServiceException.forbidden(
                        "Device outlet " + claimedOutletId + " cannot push events for outlet " + payloadOutletId
                    );
                }
            }
        }

        deviceService.recordLastSeen(requestDeviceId);

        List<String> accepted = new ArrayList<>();
        List<SyncDtos.RejectedEvent> rejected = new ArrayList<>();

        for (SyncDtos.PushEvent event : request.events()) {
            String idemKey = event.idempotencyKey();
            String payloadHash = sha256(serializePayload(event.payload()));
            long outletId = extractOutletId(event.payload());
            ProcessedEventLookup prior = idemKey == null ? null
                : findProcessedEvent(idemKey, requestDeviceId, payloadHash);
            if (prior != null) {
                if ("SUCCESS".equals(prior.resultStatus)) {
                    accepted.add(event.eventId());
                    posMetrics.recordSyncPushEvent(event.type(), "accepted_duplicate");
                    continue;
                }
                if (isRetryableSyncFailure(prior.rejectedReason)) {
                    posMetrics.recordSyncPushEvent(event.type(), "retry_rejected_duplicate");
                } else {
                    rejected.add(new SyncDtos.RejectedEvent(event.eventId(),
                        prior.rejectedReason == null ? "previously_rejected" : prior.rejectedReason));
                    posMetrics.recordSyncPushEvent(event.type(), "rejected_duplicate");
                    continue;
                }
            }
            try {
                posMetrics.recordSyncPushDuration(event.type(), () -> routeEvent(event));
                accepted.add(event.eventId());
                posMetrics.recordSyncPushEvent(event.type(), "accepted");
                if (idemKey != null) {
                    recordProcessedEvent(idemKey, requestDeviceId, outletId, event.type(),
                        payloadHash, "SUCCESS", null, parseInstantOrNull(event.clientOccurredAt()));
                }
            } catch (Exception e) {
                rejected.add(new SyncDtos.RejectedEvent(event.eventId(), e.getMessage()));
                posMetrics.recordSyncPushEvent(event.type(), "rejected");
                if (idemKey != null && !isRetryableSyncFailure(e.getMessage())) {
                    recordProcessedEvent(idemKey, requestDeviceId, outletId, event.type(),
                        payloadHash, "REJECTED", e.getMessage(), parseInstantOrNull(event.clientOccurredAt()));
                }
            }
        }
        return new SyncDtos.PushResponse(accepted, rejected);
    }

    private static boolean isRetryableSyncFailure(String reason) {
        if (reason == null || reason.isBlank()) return false;
        return reason.startsWith("Transaction failed")
            || reason.startsWith("Query failed:")
            || reason.startsWith("Execute failed:")
            || reason.contains("Connection")
            || reason.contains("timeout");
    }

    private record ProcessedEventLookup(String resultStatus, String rejectedReason) {}

    private ProcessedEventLookup findProcessedEvent(String idempotencyKey, long deviceId, String payloadHash) {
        String sql = """
            SELECT result_status, rejected_reason
            FROM core.processed_events
            WHERE idempotency_key = ?
              AND device_id = ?
              AND payload_hash = ?
              AND server_received_at >= NOW() - INTERVAL '90 days'
            ORDER BY server_received_at DESC
            LIMIT 1
            """;
        return executeInTransaction(conn -> {
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, idempotencyKey);
                ps.setLong(2, deviceId);
                ps.setString(3, payloadHash);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        return new ProcessedEventLookup(rs.getString(1), rs.getString(2));
                    }
                    return null;
                }
            }
        });
    }

    private void recordProcessedEvent(
        String idempotencyKey, long deviceId, long outletId, String eventType,
        String payloadHash, String resultStatus, String rejectedReason, Instant clientOccurredAt
    ) {
        String sql = """
            INSERT INTO core.processed_events
              (id, idempotency_key, device_id, outlet_id, event_type, payload_hash,
               result_status, rejected_reason, client_occurred_at, server_received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON CONFLICT DO NOTHING
            """;
        try {
            executeInTransaction(conn -> {
                try (PreparedStatement ps = conn.prepareStatement(sql)) {
                    ps.setLong(1, snowflake.generateId());
                    ps.setString(2, idempotencyKey);
                    ps.setLong(3, deviceId);
                    ps.setLong(4, outletId);
                    ps.setString(5, eventType);
                    ps.setString(6, payloadHash);
                    ps.setString(7, resultStatus);
                    ps.setString(8, rejectedReason == null ? null
                        : (rejectedReason.length() > 500 ? rejectedReason.substring(0, 500) : rejectedReason));
                    if (clientOccurredAt == null) {
                        ps.setNull(9, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
                    } else {
                        ps.setTimestamp(9, Timestamp.from(clientOccurredAt));
                    }
                    ps.executeUpdate();
                    return null;
                }
            });
        } catch (RuntimeException ex) {
            // Dedup record is best-effort. Failure here must not break the sync response,
            // but we still surface it to logs via metric so DLQ-grade replay can be investigated.
            posMetrics.recordSyncPushEvent(eventType, "processed_events_insert_failed");
        }
    }

    private List<RecipeComponentRow> loadRecipeComponents(Connection conn, long productId, String version) throws SQLException {
        String sql = """
            SELECT
              ri.item_id,
              i.code AS item_code,
              i.name AS item_name,
              ri.qty,
              r.yield_qty,
              ri.uom_code,
              i.base_uom_code,
              CASE
                WHEN ri.uom_code = i.base_uom_code THEN 1.00000000
                ELSE COALESCE(uc.conversion_factor, 0)
              END AS conversion_factor
            FROM core.recipe_item ri
            JOIN core.recipe r
              ON r.product_id = ri.product_id
             AND r.version = ri.version
            JOIN core.item i ON i.id = ri.item_id
            LEFT JOIN core.uom_conversion uc
              ON uc.from_uom_code = ri.uom_code
             AND uc.to_uom_code = i.base_uom_code
            WHERE ri.product_id = ?
              AND ri.version = ?
            ORDER BY ri.item_id
            """;
        List<RecipeComponentRow> components = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ps.setString(2, version);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    components.add(new RecipeComponentRow(
                        rs.getLong("item_id"),
                        rs.getString("item_code"),
                        rs.getString("item_name"),
                        toPlainString(rs.getBigDecimal("qty")),
                        toPlainString(rs.getBigDecimal("yield_qty")),
                        rs.getString("uom_code"),
                        rs.getString("base_uom_code"),
                        toPlainString(rs.getBigDecimal("conversion_factor"))
                    ));
                }
            }
        }
        return components;
    }

    private long computeMenuVersion(Connection conn) throws SQLException {
        String sql = """
            SELECT GREATEST(
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product), 0),
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product_price), 0),
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.product_variant), 0),
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint FROM core.modifier_group), 0),
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM created_at) * 1000)::bigint FROM core.modifier_option), 0)
            ) AS version
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong("version");
        }
    }

    @FunctionalInterface
    private interface ResultMapper<T> {
        T map(ResultSet rs) throws SQLException;
    }

    private <T> List<T> queryRows(Connection conn, String sql, ResultMapper<T> mapper) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            List<T> rows = new ArrayList<>();
            while (rs.next()) {
                rows.add(mapper.map(rs));
            }
            return rows;
        }
    }

    private String toPlainString(BigDecimal value) {
        if (value == null) {
            return "0";
        }
        return value.stripTrailingZeros().toPlainString();
    }

    private String serializePayload(Object payload) {
        if (payload == null) return "null";
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (Exception ex) {
            return String.valueOf(payload);
        }
    }

    private static String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    private static Instant parseInstantOrNull(String iso) {
        if (iso == null || iso.isBlank()) return null;
        try {
            return Instant.parse(iso);
        } catch (Exception ex) {
            return null;
        }
    }

    private static long extractOutletId(Object payload) {
        if (payload instanceof Map<?, ?> map) {
            Object v = map.containsKey("outlet_id") ? map.get("outlet_id") : map.get("outletId");
            if (v instanceof Number n) return n.longValue();
            if (v != null) {
                try { return Long.parseLong(String.valueOf(v)); } catch (NumberFormatException ignored) {}
            }
        }
        return 0L;
    }

    @SuppressWarnings("unchecked")
    private void routeEvent(SyncDtos.PushEvent event) {
        switch (event.type()) {
            case "pos.sale.voided" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long saleId = toLong(payloadValue(p, "sale_id", "saleId"));
                String reason = toStr(p.get("reason"), "voided_offline");
                salesService.voidSaleFromSync(saleId, reason);
            }
            case "pos.sale.submitted" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.submitSaleFromSync(p);
            }
            case "pos.sale.approved" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.approveSaleFromSync(p);
            }
            case "pos.payment.captured" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.capturePaymentFromSync(p);
            }
            case "pos.audit.recorded" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                appendPosAuditRecorded(event, p);
            }
            case "pos.sale.refunded" -> {
                throw ServiceException.conflict("Offline refund is disabled");
            }
            case "pos.session.opened" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.openPosSessionFromSync(p);
            }
            case "pos.session.closed" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long sessionId = toLong(payloadValue(p, "session_id", "sessionId"));
                salesService.closePosSessionFromSync(sessionId);
            }
            case "pos.inventory.adjusted" -> {
                throw ServiceException.conflict("Offline inventory adjustment must be synced through inventory-service");
            }
            default -> throw ServiceException.badRequest("Unknown event type: " + event.type());
        }
    }

    private void appendPosAuditRecorded(SyncDtos.PushEvent event, Map<String, Object> payload) {
        long auditId = toLong(payloadValue(payload, "event_id", "eventId"));
        executeInTransaction(conn -> {
            outboxWriter.append(
                conn,
                "pos.audit.recorded",
                auditId,
                "fern.audit.pos-recorded",
                event.eventId(),
                payload
            );
            return null;
        });
    }

    private static long toLong(Object v) {
        if (v instanceof Number n) return n.longValue();
        return Long.parseLong(String.valueOf(v));
    }

    private static BigDecimal toBigDecimal(Object v) {
        return SalesService.toBigDecimal(v);
    }

    private static String toStr(Object v, String defaultValue) {
        return SalesService.toStr(v, defaultValue);
    }

    private static Object payloadValue(Map<String, Object> payload, String snakeCase, String camelCase) {
        return SalesService.payloadValue(payload, snakeCase, camelCase);
    }
}
