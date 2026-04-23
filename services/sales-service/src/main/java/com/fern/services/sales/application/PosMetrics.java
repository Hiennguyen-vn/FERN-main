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
        // outbox_pending_depth — Gauge backed by DB count
        registry.gauge("outbox_pending_depth", this, PosMetrics::outboxPendingDepth);

        // outbox_publish_lag_seconds — seconds since oldest PENDING event
        registry.gauge("outbox_publish_lag_seconds", this, PosMetrics::outboxPublishLagSeconds);

        // outbox_publish_rate_total counters
        publishedCounter = registry.counter("outbox_publish_rate_total", "status", "published");
        failedCounter = registry.counter("outbox_publish_rate_total", "status", "failed");

        // device_last_seen_lag_seconds — only during business hours
        registry.gauge("device_last_seen_lag_seconds", this, PosMetrics::deviceLastSeenLagSeconds);

        // inventory_negative_balance_total
        registry.gauge("inventory_negative_balance_total", this, PosMetrics::inventoryNegativeBalance);
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

    // ── Public counter/timer methods for callsites ────────────────────────────

    public void incrementOutboxPublished() {
        publishedCounter.increment();
    }

    public void incrementOutboxFailed() {
        failedCounter.increment();
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

    public void recordPaymentStateTransition(String fromState, String toState) {
        registry.counter("payment_state_transitions_total",
            "from_state", fromState, "to_state", toState).increment();
    }
}
