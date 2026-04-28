package com.fern.common.outbox;

import com.fern.common.spring.events.TypedKafkaEventPublisher;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;

/**
 * Drains FAILED outbox rows whose DLQ copy has not yet been published.
 * This closes the window where the primary outbox row is committed as FAILED
 * but Kafka DLQ was unavailable at that exact moment.
 */
public class OutboxDlqForwarder {

    private static final int BATCH_LIMIT = 100;
    private static final int PROCESSING_RECLAIM_SECONDS = 120;
    private static final long[] BACKOFF_SECONDS = {5, 15, 30, 60, 120, 300, 600};

    private final DataSource dataSource;
    private final TypedKafkaEventPublisher publisher;
    private final String dlqTopic;
    private final Optional<MeterRegistry> meterRegistry;

    public OutboxDlqForwarder(
        DataSource dataSource,
        TypedKafkaEventPublisher publisher,
        String dlqTopic,
        Optional<MeterRegistry> meterRegistry
    ) {
        this.dataSource = dataSource;
        this.publisher = publisher;
        this.dlqTopic = dlqTopic;
        this.meterRegistry = meterRegistry;
    }

    public void drain() {
        String owner = UUID.randomUUID().toString();
        List<DlqCandidate> batch = claimBatch(owner);
        for (DlqCandidate candidate : batch) {
            try {
                publish(candidate);
                markPublished(candidate, owner);
            } catch (Exception e) {
                markRetry(candidate, owner, e.getMessage());
            }
        }
    }

    private List<DlqCandidate> claimBatch(String owner) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                List<DlqCandidate> batch = fetchAndClaimBatch(conn, owner);
                conn.commit();
                return batch;
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("OutboxDlqForwarder.drain failed", e);
        } catch (Exception e) {
            throw new RuntimeException("OutboxDlqForwarder.drain failed", e);
        }
    }

    private List<DlqCandidate> fetchAndClaimBatch(Connection conn, String owner) throws SQLException {
        String sql = """
            WITH candidates AS (
              SELECT id, created_at
              FROM core.outbox_event
              WHERE status = 'FAILED'
                AND (
                  (
                    dlq_status = 'PENDING'
                    AND (dlq_retry_after IS NULL OR dlq_retry_after <= NOW())
                  ) OR (
                    dlq_status = 'PROCESSING'
                    AND dlq_processing_started_at IS NOT NULL
                    AND dlq_processing_started_at <= NOW() - (?::int * INTERVAL '1 second')
                  )
                )
              ORDER BY created_at
              LIMIT ?
              FOR UPDATE SKIP LOCKED
            )
            UPDATE core.outbox_event oe
            SET dlq_status = 'PROCESSING',
                dlq_processing_started_at = NOW(),
                dlq_processing_owner = ?
            FROM candidates c
            WHERE oe.id = c.id AND oe.created_at = c.created_at
            RETURNING oe.id, oe.aggregate_type, oe.aggregate_id, oe.topic, oe.event_key,
                      oe.payload, oe.headers, oe.created_at, oe.attempt_count,
                      oe.last_error, oe.dlq_attempt_count
            """;
        List<DlqCandidate> results = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, PROCESSING_RECLAIM_SECONDS);
            ps.setInt(2, BATCH_LIMIT);
            ps.setString(3, owner);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    results.add(new DlqCandidate(
                        rs.getLong("id"),
                        rs.getString("aggregate_type"),
                        rs.getLong("aggregate_id"),
                        rs.getString("topic"),
                        rs.getString("event_key"),
                        rs.getString("payload"),
                        rs.getString("headers"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getInt("attempt_count"),
                        rs.getString("last_error"),
                        rs.getInt("dlq_attempt_count")
                    ));
                }
            }
        }
        return results;
    }

    private void publish(DlqCandidate candidate) {
        publisher.publishAndAwait(
            dlqTopic,
            Long.toString(candidate.id()),
            "outbox.publish.failed",
            new DlqEnvelope(
                candidate.id(),
                candidate.aggregateType(),
                candidate.aggregateId(),
                candidate.originalTopic(),
                candidate.eventKey(),
                candidate.payload(),
                candidate.headers(),
                candidate.outboxAttemptCount(),
                candidate.lastError(),
                candidate.createdAt(),
                Instant.now()
            )
        );
        meterRegistry.ifPresent(r -> r.counter("outbox_dlq_published_total").increment());
    }

    private void markPublished(DlqCandidate candidate, String owner) {
        String sql = """
            UPDATE core.outbox_event
            SET dlq_status='PUBLISHED',
                dlq_published_at=NOW(),
                dlq_retry_after=NULL,
                dlq_last_error=NULL,
                dlq_processing_started_at=NULL,
                dlq_processing_owner=NULL
            WHERE id=? AND created_at=? AND dlq_status='PROCESSING' AND dlq_processing_owner=?
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, candidate.id());
            ps.setTimestamp(2, Timestamp.from(candidate.createdAt()));
            ps.setString(3, owner);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("OutboxDlqForwarder.markPublished failed", e);
        }
    }

    private void markRetry(DlqCandidate candidate, String owner, String error) {
        int nextAttempt = candidate.dlqAttemptCount() + 1;
        long backoffSec = nextAttempt < BACKOFF_SECONDS.length
            ? BACKOFF_SECONDS[nextAttempt]
            : BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
        String normalizedError = error != null && error.length() > 500 ? error.substring(0, 500) : error;
        String sql = """
            UPDATE core.outbox_event
            SET dlq_status='PENDING',
                dlq_attempt_count=?,
                dlq_retry_after=NOW() + (? || ' seconds')::interval,
                dlq_last_error=?,
                dlq_processing_started_at=NULL,
                dlq_processing_owner=NULL
            WHERE id=? AND created_at=? AND dlq_status='PROCESSING' AND dlq_processing_owner=?
            """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, nextAttempt);
            ps.setString(2, String.valueOf(backoffSec));
            ps.setString(3, normalizedError);
            ps.setLong(4, candidate.id());
            ps.setTimestamp(5, Timestamp.from(candidate.createdAt()));
            ps.setString(6, owner);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("OutboxDlqForwarder.markRetry failed", e);
        }
        meterRegistry.ifPresent(r -> r.counter("outbox_dlq_publish_failures_total").increment());
    }

    private record DlqCandidate(
        long id,
        String aggregateType,
        long aggregateId,
        String originalTopic,
        String eventKey,
        String payload,
        String headers,
        Instant createdAt,
        int outboxAttemptCount,
        String lastError,
        int dlqAttemptCount
    ) {
    }

    private record DlqEnvelope(
        long outboxId,
        String aggregateType,
        long aggregateId,
        String originalTopic,
        String eventKey,
        String payload,
        String headers,
        int outboxAttemptCount,
        String error,
        Instant createdAt,
        Instant dlqPublishedAt
    ) {
    }
}
