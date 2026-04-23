package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.fern.services.sales.api.SyncDtos;
import com.fern.services.sales.api.SyncDtos.CatalogRow;
import com.fern.services.sales.api.SyncDtos.StockRow;
import javax.sql.DataSource;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SyncService extends BaseRepository {

    public SyncService(DataSource dataSource) {
        super(dataSource);
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
                routeEvent(event);
                accepted.add(event.eventId());
            } catch (Exception e) {
                rejected.add(new SyncDtos.RejectedEvent(event.eventId(), e.getMessage()));
            }
        }
        return new SyncDtos.PushResponse(accepted, rejected);
    }

    private void routeEvent(SyncDtos.PushEvent event) {
        // Event routing stub — full routing wired in W4 when handlers are complete.
        // Unknown types are accepted optimistically (server-side logged, not rejected).
        switch (event.type()) {
            case "pos.sale.submitted",
                 "pos.sale.approved",
                 "pos.payment.captured",
                 "pos.sale.voided",
                 "pos.sale.refunded",
                 "pos.session.opened",
                 "pos.session.closed",
                 "pos.inventory.adjusted" -> { /* accepted — full handler in W4 */ }
            default -> throw ServiceException.badRequest("Unknown event type: " + event.type());
        }
    }
}
