package com.dorabets.common.outbox;

import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javax.sql.DataSource;
import java.sql.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Polls core.outbox_event for PENDING rows and publishes to Kafka.
 * Uses SELECT FOR UPDATE SKIP LOCKED — safe for multiple concurrent instances.
 * Call drain() on a fixed schedule (e.g. every 1s via @Scheduled).
 */
public class OutboxRelay {

    private static final int BATCH_LIMIT = 100;
    private static final int MAX_ATTEMPTS = 10;
    private static final long[] BACKOFF_SECONDS = {1, 2, 4, 8, 16, 30, 60, 120, 300, 600};

    private final DataSource dataSource;
    private final TypedKafkaEventPublisher publisher;
    private final ObjectMapper objectMapper;

    public OutboxRelay(DataSource dataSource, TypedKafkaEventPublisher publisher, ObjectMapper objectMapper) {
        this.dataSource = dataSource;
        this.publisher = publisher;
        this.objectMapper = objectMapper;
    }

    public void drain() {
        List<OutboxEvent> batch = fetchBatch();
        for (OutboxEvent event : batch) {
            try {
                publishEvent(event);
                markPublished(event.id(), event.createdAt());
            } catch (Exception e) {
                markFailed(event.id(), event.createdAt(), event.attemptCount(), e.getMessage());
            }
        }
    }

    private List<OutboxEvent> fetchBatch() {
        String sql = """
            SELECT id, aggregate_type, aggregate_id, topic, event_key, payload, created_at, attempt_count
            FROM core.outbox_event
            WHERE status = 'PENDING'
              AND (retry_after IS NULL OR retry_after <= NOW())
            ORDER BY created_at
            LIMIT ?
            FOR UPDATE SKIP LOCKED
            """;
        List<OutboxEvent> results = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setInt(1, BATCH_LIMIT);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        results.add(new OutboxEvent(
                            rs.getLong("id"),
                            rs.getString("aggregate_type"),
                            rs.getLong("aggregate_id"),
                            rs.getString("topic"),
                            rs.getString("event_key"),
                            rs.getString("payload"),
                            null,
                            rs.getTimestamp("created_at").toInstant(),
                            "PENDING",
                            rs.getInt("attempt_count"),
                            null,
                            null
                        ));
                    }
                }
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("OutboxRelay.fetchBatch failed", e);
        }
        return results;
    }

    private void publishEvent(OutboxEvent event) throws Exception {
        JsonNode payloadNode = objectMapper.readTree(event.payload());
        publisher.publish(event.topic(), event.eventKey(), event.aggregateType(), payloadNode);
    }

    private void markPublished(long id, Instant createdAt) {
        String sql = "UPDATE core.outbox_event SET status='PUBLISHED', published_at=NOW() " +
                     "WHERE id=? AND created_at=?";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.setTimestamp(2, Timestamp.from(createdAt));
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("OutboxRelay.markPublished failed id=" + id, e);
        }
    }

    private void markFailed(long id, Instant createdAt, int attemptCount, String error) {
        int newAttempt = attemptCount + 1;
        String newStatus = newAttempt >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
        long backoffSec = newAttempt < BACKOFF_SECONDS.length
            ? BACKOFF_SECONDS[newAttempt]
            : BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];

        String sql = "UPDATE core.outbox_event " +
                     "SET status=?, attempt_count=?, retry_after=NOW() + (? || ' seconds')::interval, last_error=? " +
                     "WHERE id=? AND created_at=?";
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, newStatus);
            ps.setInt(2, newAttempt);
            ps.setString(3, String.valueOf(backoffSec));
            ps.setString(4, error != null && error.length() > 500 ? error.substring(0, 500) : error);
            ps.setLong(5, id);
            ps.setTimestamp(6, Timestamp.from(createdAt));
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("OutboxRelay.markFailed failed id=" + id, e);
        }
    }
}
