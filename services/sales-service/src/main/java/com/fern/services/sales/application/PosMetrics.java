package com.fern.services.sales.application;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalTime;
import org.springframework.stereotype.Component;

@Component
public class PosMetrics {

    private final MeterRegistry registry;
    private final DataSource dataSource;

    private Counter publishedCounter;
    private Counter failedCounter;

    public PosMetrics(MeterRegistry registry, DataSource dataSource) {
        this.registry = registry;
        this.dataSource = dataSource;
    }

    @PostConstruct
    public void registerMetrics() {
        // pos_waste_rate — ratio waste_out / (waste_out + sale_usage) qty in last 24h
        registry.gauge("pos_waste_rate", this, m -> m.wasteRate24h());

        // pos_shift_variance_vnd — largest absolute cash variance across recent closed sessions
        registry.gauge("pos_shift_variance_vnd_abs_max", this, m -> m.shiftVarianceAbsMax());

        // outbox_pending_depth — Gauge backed by DB count
        registry.gauge("outbox_pending_depth", this, PosMetrics::outboxPendingDepth);

        // outbox_publish_lag_seconds — seconds since oldest PENDING event
        registry.gauge("outbox_publish_lag_seconds", this, PosMetrics::outboxPublishLagSeconds);

        // outbox_publish_rate_total counters
        publishedCounter = registry.counter("outbox_publish_rate_total", "status", "published");
        failedCounter = registry.counter("outbox_publish_rate_total", "status", "failed");
        registry.gauge("outbox_failed_depth", this, PosMetrics::outboxFailedDepth);
        registry.gauge("outbox_dlq_pending_depth", this, PosMetrics::outboxDlqPendingDepth);
        registry.gauge("outbox_dlq_oldest_age_seconds", this, PosMetrics::outboxDlqOldestAgeSeconds);

        // device_last_seen_lag_seconds — only during business hours
        registry.gauge("device_last_seen_lag_seconds", this, PosMetrics::deviceLastSeenLagSeconds);

        // inventory_negative_balance_total
        registry.gauge("inventory_negative_balance_total", this, PosMetrics::inventoryNegativeBalance);

        // pos_oversell_total — sales submitted with oversell_flag=true (last 24h)
        registry.gauge("pos_oversell_total", this, PosMetrics::oversell24h);

        // pos_offline_duration_seconds_max — longest gap between device last_seen and now (active devices)
        registry.gauge("pos_offline_duration_seconds_max", this, PosMetrics::offlineDurationMax);
    }

    // ── Gauge suppliers ───────────────────────────────────────────────────────

    private double outboxPendingDepth() {
        String sql = "SELECT COUNT(*) FROM core.outbox_event WHERE status='PENDING'";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double outboxPublishLagSeconds() {
        String sql = "SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) FROM core.outbox_event WHERE status='PENDING'";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                double lag = rs.getDouble(1);
                return rs.wasNull() ? 0 : lag;
            }
            return 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double outboxFailedDepth() {
        String sql = "SELECT COUNT(*) FROM core.outbox_event WHERE status='FAILED'";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double outboxDlqPendingDepth() {
        String sql = "SELECT COUNT(*) FROM core.outbox_event WHERE status='FAILED' AND dlq_status='PENDING'";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double outboxDlqOldestAgeSeconds() {
        String sql = """
            SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))
            FROM core.outbox_event
            WHERE status='FAILED' AND dlq_status='PENDING'
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                double lag = rs.getDouble(1);
                return rs.wasNull() ? 0 : lag;
            }
            return 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double deviceLastSeenLagSeconds() {
        LocalTime now = LocalTime.now();
        LocalTime start = LocalTime.of(8, 0);
        LocalTime end = LocalTime.of(22, 0);
        if (now.isBefore(start) || now.isAfter(end)) {
            return 0;
        }
        String sql = "SELECT EXTRACT(EPOCH FROM (NOW() - MIN(last_seen_at))) " +
                     "FROM core.device_registry WHERE revoked_at IS NULL";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                double lag = rs.getDouble(1);
                return rs.wasNull() ? 0 : lag;
            }
            return 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double inventoryNegativeBalance() {
        String sql = "SELECT COUNT(*) FROM core.stock_balance WHERE qty_on_hand < 0";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double oversell24h() {
        String sql = """
            SELECT COUNT(*) FROM core.sale_record
            WHERE oversell_flag = true
              AND created_at >= NOW() - INTERVAL '24 hours'
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double offlineDurationMax() {
        String sql = """
            SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - last_seen_at))), 0)
            FROM core.device_registry
            WHERE revoked_at IS NULL AND last_seen_at IS NOT NULL
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getDouble(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    double wasteRate24h() {
        String sql = """
            SELECT
              SUM(CASE WHEN txn_type = 'waste_out' THEN ABS(qty_change) ELSE 0 END)  AS waste_qty,
              SUM(CASE WHEN txn_type = 'sale_usage' THEN ABS(qty_change) ELSE 0 END) AS sale_qty
            FROM core.inventory_transaction
            WHERE txn_time >= NOW() - INTERVAL '24 hours'
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) return 0;
            double waste = rs.getDouble("waste_qty");
            double sale  = rs.getDouble("sale_qty");
            double total = waste + sale;
            return total > 0 ? waste / total : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    double shiftVarianceAbsMax() {
        // discrepancy_total in VND (NUMERIC 18,2); convert to cents for metric
        String sql = """
            SELECT COALESCE(MAX(ABS(discrepancy_total)) * 100, 0)
            FROM core.pos_session_reconciliation
            WHERE reconciled_at >= NOW() - INTERVAL '24 hours'
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getDouble(1) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    // ── Public counter/timer methods for callsites ────────────────────────────

    public void incrementOutboxPublished() {
        publishedCounter.increment();
    }

    public void incrementOutboxFailed() {
        failedCounter.increment();
    }

    /** Records end-to-end order completion time (submit → approve → mark-payment-done). */
    public Timer orderCompletionTimer() {
        return Timer.builder("pos_order_completion_seconds")
            .description("End-to-end POS order completion latency")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(registry);
    }

    public void recordSyncPushEvent(String eventType, String outcome) {
        registry.counter("sync_push_events_total", "event_type", eventType, "outcome", outcome).increment();
    }

    public void recordSyncPushDuration(String eventType, Runnable action) {
        Timer timer = Timer.builder("sync_push_duration_seconds")
            .tag("event_type", eventType)
            .register(registry);
        timer.record(action);
    }

    public void recordPriceDriftDetected(long outletId, int linesFlagged) {
        if (linesFlagged <= 0) return;
        registry.counter("sale_legacy_price_total", "outlet_id", String.valueOf(outletId))
            .increment(linesFlagged);
    }

    public void recordPaymentStateTransition(String fromState, String toState) {
        registry.counter("payment_state_transitions_total",
            "from_state", fromState, "to_state", toState).increment();
    }
}
