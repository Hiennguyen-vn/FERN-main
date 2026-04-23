package com.dorabets.common.outbox;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;

/**
 * Appends outbox events within the same DB connection/transaction as the business operation.
 * Caller must pass the active Connection so the INSERT is atomic with the business write.
 */
public class OutboxWriter {

    private final ObjectMapper objectMapper;
    private final IdGenerator idGenerator;

    public OutboxWriter(ObjectMapper objectMapper, IdGenerator idGenerator) {
        this.objectMapper = objectMapper;
        this.idGenerator = idGenerator;
    }

    /**
     * Append an outbox event using the caller-supplied connection (must be in active transaction).
     */
    public void append(Connection conn, String aggregateType, long aggregateId,
                       String topic, String eventKey, Object payload) {
        try {
            String payloadJson = objectMapper.writeValueAsString(payload);
            long id = idGenerator.next();
            Instant now = Instant.now();

            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO core.outbox_event " +
                    "(id, aggregate_type, aggregate_id, topic, event_key, payload, created_at, status, attempt_count) " +
                    "VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING', 0)")) {
                ps.setLong(1, id);
                ps.setString(2, aggregateType);
                ps.setLong(3, aggregateId);
                ps.setString(4, topic);
                ps.setString(5, eventKey);
                ps.setString(6, payloadJson);
                ps.setTimestamp(7, Timestamp.from(now));
                ps.executeUpdate();
            }
        } catch (Exception e) {
            throw new RuntimeException("OutboxWriter.append failed for aggregate=" + aggregateType + ":" + aggregateId, e);
        }
    }

    @FunctionalInterface
    public interface IdGenerator {
        long next();
    }
}
