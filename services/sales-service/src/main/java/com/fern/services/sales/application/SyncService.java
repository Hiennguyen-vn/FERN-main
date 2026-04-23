package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.fern.services.sales.api.SyncDtos;
import com.fern.services.sales.api.SyncDtos.CatalogRow;
import com.fern.services.sales.api.SyncDtos.StockRow;
import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class SyncService extends BaseRepository {

    private final SalesService salesService;
    private final PosMetrics posMetrics;

    public SyncService(DataSource dataSource, SalesService salesService, PosMetrics posMetrics) {
        super(dataSource);
        this.salesService = salesService;
        this.posMetrics = posMetrics;
    }

    // ── Catalog pull ──────────────────────────────────────────────────────────

    /**
     * Returns catalog rows updated since {@code sinceEpochMs} for the given outlet.
     * sinceEpochMs = 0 returns full catalog.
     */
    public List<CatalogRow> pullCatalog(long outletId, long sinceEpochMs, int limit) {
        String sql = """
            SELECT
              p.id                          AS product_id,
              p.name                        AS product_name,
              pc.id                         AS category_id,
              pc.name                       AS category_name,
              COALESCE(poa.is_available, true) AS is_available,
              COALESCE(
                ROUND(pp.price_value * 100)::bigint,
                0
              )                             AS price_cents,
              EXTRACT(EPOCH FROM p.updated_at) * 1000 AS updated_at_ms
            FROM core.product p
            JOIN core.product_category pc ON p.category_id = pc.id
            LEFT JOIN core.product_outlet_availability poa
                   ON poa.product_id = p.id AND poa.outlet_id = ?
            LEFT JOIN core.product_price pp
                   ON pp.product_id = p.id
                  AND pp.outlet_id = ?
                  AND pp.effective_from <= CURRENT_DATE
                  AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
            WHERE p.status = 'active'
              AND EXTRACT(EPOCH FROM p.updated_at) * 1000 > ?
            ORDER BY p.updated_at ASC
            LIMIT ?
            """;
        return executeInTransaction(conn -> {
            List<CatalogRow> rows = new ArrayList<>();
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, outletId);
                ps.setLong(2, outletId);
                ps.setLong(3, sinceEpochMs);
                ps.setInt(4, limit);
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
        String sql = """
            SELECT
              sb.item_id,
              sb.outlet_id,
              sb.qty_on_hand::text,
              COALESCE(
                EXTRACT(EPOCH FROM MAX(it.txn_time)) * 1000,
                0
              )::bigint AS last_movement_ms
            FROM core.stock_balance sb
            LEFT JOIN core.inventory_transaction it
                   ON it.item_id = sb.item_id AND it.outlet_id = sb.outlet_id
            WHERE sb.outlet_id = ?
            GROUP BY sb.item_id, sb.outlet_id, sb.qty_on_hand
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

    // ── Manifest ──────────────────────────────────────────────────────────────

    public SyncDtos.ManifestResponse manifest() {
        // Catalog version = max updated_at epoch ms across products
        // Price version   = max updated_at epoch ms across product_prices
        // Stock version   = max txn_time epoch ms across inventory_transactions
        String sql = """
            SELECT
              COALESCE(MAX(EXTRACT(EPOCH FROM p.updated_at) * 1000)::bigint, 0)  AS catalog_version,
              COALESCE(MAX(EXTRACT(EPOCH FROM pp.updated_at) * 1000)::bigint, 0) AS price_version,
              COALESCE(MAX(EXTRACT(EPOCH FROM it.txn_time) * 1000)::bigint, 0)   AS stock_version
            FROM core.product p
            FULL OUTER JOIN core.product_price pp ON TRUE
            FULL OUTER JOIN core.inventory_transaction it ON TRUE
            """;
        return executeInTransaction(conn -> {
            try (PreparedStatement ps = conn.prepareStatement(sql);
                 ResultSet rs = ps.executeQuery()) {
                rs.next();
                return new SyncDtos.ManifestResponse(
                    rs.getLong("catalog_version"),
                    rs.getLong("price_version"),
                    rs.getLong("stock_version"),
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

        deviceService.recordLastSeen(request.deviceId());

        List<String> accepted = new ArrayList<>();
        List<SyncDtos.RejectedEvent> rejected = new ArrayList<>();

        for (SyncDtos.PushEvent event : request.events()) {
            try {
                posMetrics.recordSyncPushDuration(event.type(), () -> routeEvent(event));
                accepted.add(event.eventId());
                posMetrics.recordSyncPushEvent(event.type(), "accepted");
            } catch (Exception e) {
                rejected.add(new SyncDtos.RejectedEvent(event.eventId(), e.getMessage()));
                posMetrics.recordSyncPushEvent(event.type(), "rejected");
            }
        }
        return new SyncDtos.PushResponse(accepted, rejected);
    }

    @SuppressWarnings("unchecked")
    private void routeEvent(SyncDtos.PushEvent event) {
        switch (event.type()) {
            case "pos.sale.voided" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long saleId = toLong(p.get("sale_id"));
                String reason = toStr(p.get("reason"), "voided_offline");
                salesService.voidSaleFromSync(saleId, reason);
            }
            case "pos.sale.submitted" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.submitSaleFromSync(p);
            }
            case "pos.sale.approved" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long saleId = toLong(p.get("sale_id"));
                Long actorUserId = p.containsKey("actor_user_id") && p.get("actor_user_id") != null
                    ? toLong(p.get("actor_user_id")) : null;
                salesService.approveSaleFromSync(saleId, actorUserId);
            }
            case "pos.payment.captured" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.capturePaymentFromSync(p);
            }
            case "pos.sale.refunded" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long saleId = toLong(p.get("sale_id"));
                BigDecimal amount = toBigDecimal(p.get("amount"));
                String reason = toStr(p.get("reason"), "refunded_offline");
                salesService.refundSaleFromSync(saleId, amount, reason);
            }
            case "pos.session.opened" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                salesService.openPosSessionFromSync(p);
            }
            case "pos.session.closed" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                long sessionId = toLong(p.get("session_id"));
                salesService.closePosSessionFromSync(sessionId);
            }
            case "pos.inventory.adjusted" -> {
                Map<String, Object> p = (Map<String, Object>) event.payload();
                adjustInventoryFromSync(p);
            }
            default -> throw ServiceException.badRequest("Unknown event type: " + event.type());
        }
    }

    /** Direct JDBC inventory adjustment — inventory-service is not a dependency of sales-service. */
    private void adjustInventoryFromSync(Map<String, Object> payload) {
        long itemId    = toLong(payload.get("item_id"));
        long outletId  = toLong(payload.get("outlet_id"));
        BigDecimal qtyDelta = toBigDecimal(payload.get("qty_delta"));
        String reason  = toStr(payload.get("reason"), "sync_adjustment");
        String clientOccurredAt = toStr(payload.get("client_occurred_at"), null);
        Instant txnTime = clientOccurredAt != null ? Instant.parse(clientOccurredAt) : Instant.now();
        String txnType = qtyDelta.compareTo(BigDecimal.ZERO) >= 0
            ? "stock_adjustment_in" : "stock_adjustment_out";

        executeInTransaction(conn -> {
            String sql = """
                INSERT INTO core.inventory_transaction
                  (item_id, outlet_id, txn_type, qty_change, reference_note, txn_time, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """;
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setLong(1, itemId);
                ps.setLong(2, outletId);
                ps.setString(3, txnType);
                ps.setBigDecimal(4, qtyDelta);
                ps.setString(5, reason);
                ps.setTimestamp(6, Timestamp.from(txnTime));
                ps.setTimestamp(7, Timestamp.from(Instant.now()));
                ps.executeUpdate();
            }
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
}
