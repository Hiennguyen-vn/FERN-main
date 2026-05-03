package com.fern.common.outbox;

import com.fern.common.spring.events.TypedKafkaEventPublisher;
import com.fern.common.util.UuidV5;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import java.sql.*;

/**
 * Polls core.outbox_event for PENDING rows and publishes to Kafka.
 * Uses SELECT FOR UPDATE SKIP LOCKED — safe for multiple concurrent instances.
 * Call drain() on a fixed schedule (e.g. every 1s via @Scheduled).
 *
 * <p>Tunable parameters (override via constructor or Spring @Value bindings):
 * <ul>
 *   <li>{@code outbox.batch-limit} — rows claimed per drain cycle (default 25).
 *       Keep small when Kafka publish is synchronous to prevent reclaim storms.</li>
 *   <li>{@code outbox.reclaim-seconds} — seconds before a stuck PROCESSING row
 *       is reclaimed (default 300). Must be &gt; worst-case p99 Kafka publish time.</li>
 *   <li>{@code outbox.max-attempts} — attempts before moving row to FAILED DLQ (default 10).</li>
 * </ul>
 */
public class OutboxRelay {

    public static final int DEFAULT_BATCH_LIMIT = 25;
    public static final int DEFAULT_MAX_ATTEMPTS = 10;
    public static final int DEFAULT_PROCESSING_RECLAIM_SECONDS = 300;

    private static final long[] BACKOFF_SECONDS = {1, 2, 4, 8, 16, 30, 60, 120, 300, 600};

    private final DataSource dataSource;
    private final TypedKafkaEventPublisher publisher;
    private final ObjectMapper objectMapper;
    private final Optional<MeterRegistry> meterRegistry;
    private final int batchLimit;
    private final int maxAttempts;
    private final int processingReclaimSeconds;

    public OutboxRelay(DataSource dataSource, TypedKafkaEventPublisher publisher, ObjectMapper objectMapper) {
        this(dataSource, publisher, objectMapper, Optional.empty(),
            DEFAULT_BATCH_LIMIT, DEFAULT_MAX_ATTEMPTS, DEFAULT_PROCESSING_RECLAIM_SECONDS);
    }

    public OutboxRelay(
        DataSource dataSource,
        TypedKafkaEventPublisher publisher,
        ObjectMapper objectMapper,
        Optional<MeterRegistry> meterRegistry
    ) {
        this(dataSource, publisher, objectMapper, meterRegistry,
            DEFAULT_BATCH_LIMIT, DEFAULT_MAX_ATTEMPTS, DEFAULT_PROCESSING_RECLAIM_SECONDS);
    }

    public OutboxRelay(
        DataSource dataSource,
        TypedKafkaEventPublisher publisher,
        ObjectMapper objectMapper,
        Optional<MeterRegistry> meterRegistry,
        int batchLimit,
        int maxAttempts,
        int processingReclaimSeconds
    ) {
        this.dataSource = dataSource;
        this.publisher = publisher;
        this.objectMapper = objectMapper;
        this.meterRegistry = meterRegistry;
        this.batchLimit = batchLimit > 0 ? batchLimit : DEFAULT_BATCH_LIMIT;
        this.maxAttempts = maxAttempts > 0 ? maxAttempts : DEFAULT_MAX_ATTEMPTS;
        this.processingReclaimSeconds = processingReclaimSeconds > 0
            ? processingReclaimSeconds : DEFAULT_PROCESSING_RECLAIM_SECONDS;
    }

    /**
     * Drain pending outbox rows using short DB transactions:
     * claim PENDING rows, publish outside the transaction, then mark terminal state.
     * Stale PROCESSING rows are reclaimed after PROCESSING_RECLAIM_SECONDS.
     */
    public void drain() {
        String owner = UUID.randomUUID().toString();
        List<OutboxEvent> batch = claimBatch(owner);
        for (OutboxEvent event : batch) {
            try {
                publishEvent(event);
                markPublished(event, owner);
            } catch (Exception e) {
                markFailed(event, owner, event.attemptCount(), e.getMessage());
            }
        }
    }

    private List<OutboxEvent> claimBatch(String owner) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                List<OutboxEvent> claimed = fetchAndClaimBatch(conn, owner);
                conn.commit();
                return claimed;
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (Exception e) {
            throw new RuntimeException("OutboxRelay.claimBatch failed", e);
        }
    }

    private List<OutboxEvent> fetchAndClaimBatch(Connection conn, String owner) throws SQLException {
        String sql = """
            WITH candidates AS (
              SELECT id, created_at
              FROM core.outbox_event
              WHERE (
                  status = 'PENDING'
                  AND (retry_after IS NULL OR retry_after <= NOW())
                ) OR (
                  status = 'PROCESSING'
                  AND processing_started_at IS NOT NULL
                  AND processing_started_at <= NOW() - (?::int * INTERVAL '1 second')
                )
              ORDER BY created_at
              LIMIT ?
              FOR UPDATE SKIP LOCKED
            )
            UPDATE core.outbox_event oe
            SET status = 'PROCESSING',
                processing_started_at = NOW(),
                processing_owner = ?
            FROM candidates c
            WHERE oe.id = c.id AND oe.created_at = c.created_at
            RETURNING oe.id, oe.aggregate_type, oe.aggregate_id, oe.topic, oe.event_key,
                      oe.payload, oe.headers, oe.created_at, oe.status, oe.attempt_count,
                      oe.retry_after, oe.last_error
            """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, processingReclaimSeconds);
            ps.setInt(2, batchLimit);
            ps.setString(3, owner);
            try (ResultSet rs = ps.executeQuery()) {
                return mapEvents(rs);
            }
        }
    }

    private List<OutboxEvent> mapEvents(ResultSet rs) throws SQLException {
        java.util.ArrayList<OutboxEvent> results = new java.util.ArrayList<>();
        while (rs.next()) {
            Timestamp retryAfter = rs.getTimestamp("retry_after");
            results.add(new OutboxEvent(
                rs.getLong("id"),
                rs.getString("aggregate_type"),
                rs.getLong("aggregate_id"),
                rs.getString("topic"),
                rs.getString("event_key"),
                rs.getString("payload"),
                rs.getString("headers"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getString("status"),
                rs.getInt("attempt_count"),
                retryAfter == null ? null : retryAfter.toInstant(),
                rs.getString("last_error")
            ));
        }
        return results;
    }

    private void publishEvent(OutboxEvent event) throws Exception {
        JsonNode payloadNode = objectMapper.readTree(event.payload());
        String stableEventId = UuidV5.fromOutboxId(event.id()).toString();
        publisher.publishAndAwaitWithId(stableEventId, event.topic(), event.eventKey(),
            event.aggregateType(), payloadNode, null);
    }

    private void markPublished(OutboxEvent event, String owner) {
        String sql = "UPDATE core.outbox_event " +
                     "SET status='PUBLISHED', published_at=NOW(), processing_started_at=NULL, processing_owner=NULL " +
                     "WHERE id=? AND created_at=? AND status='PROCESSING' AND processing_owner=?";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, event.id());
            ps.setTimestamp(2, Timestamp.from(event.createdAt()));
            ps.setString(3, owner);
            ps.executeUpdate();
            meterRegistry.ifPresent(r ->
                r.counter("outbox_publish_rate_total", "status", "published").increment());
        } catch (SQLException e) {
            throw new RuntimeException("OutboxRelay.markPublished failed", e);
        }
    }

    private void markFailed(
        OutboxEvent event,
        String owner,
        int attemptCount,
        String error
    ) {
        int newAttempt = attemptCount + 1;
        String newStatus = newAttempt >= maxAttempts ? "FAILED" : "PENDING";
        long backoffSec = newAttempt < BACKOFF_SECONDS.length
            ? BACKOFF_SECONDS[newAttempt]
            : BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
        String normalizedError = error != null && error.length() > 500 ? error.substring(0, 500) : error;

        String sql = "UPDATE core.outbox_event " +
                     "SET status=?, attempt_count=?, retry_after=CASE WHEN ? = 'FAILED' THEN NULL " +
                     "ELSE NOW() + (? || ' seconds')::interval END, last_error=?, " +
                     "processing_started_at=NULL, processing_owner=NULL, " +
                     "dlq_status=CASE WHEN ? = 'FAILED' THEN 'PENDING' ELSE dlq_status END, " +
                     "dlq_published_at=CASE WHEN ? = 'FAILED' THEN NULL ELSE dlq_published_at END, " +
                     "dlq_retry_after=CASE WHEN ? = 'FAILED' THEN NULL ELSE dlq_retry_after END, " +
                     "dlq_attempt_count=CASE WHEN ? = 'FAILED' THEN 0 ELSE dlq_attempt_count END, " +
                     "dlq_last_error=CASE WHEN ? = 'FAILED' THEN NULL ELSE dlq_last_error END " +
                     "WHERE id=? AND created_at=? AND status='PROCESSING' AND processing_owner=?";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, newStatus);
            ps.setInt(2, newAttempt);
            ps.setString(3, newStatus);
            ps.setString(4, String.valueOf(backoffSec));
            ps.setString(5, normalizedError);
            ps.setString(6, newStatus);
            ps.setString(7, newStatus);
            ps.setString(8, newStatus);
            ps.setString(9, newStatus);
            ps.setString(10, newStatus);
            ps.setLong(11, event.id());
            ps.setTimestamp(12, Timestamp.from(event.createdAt()));
            ps.setString(13, owner);
            ps.executeUpdate();
            if ("FAILED".equals(newStatus)) {
                meterRegistry.ifPresent(r ->
                    r.counter("outbox_publish_rate_total", "status", "failed").increment());
            }
        } catch (SQLException e) {
            throw new RuntimeException("OutboxRelay.markFailed failed", e);
        }
    }
}
