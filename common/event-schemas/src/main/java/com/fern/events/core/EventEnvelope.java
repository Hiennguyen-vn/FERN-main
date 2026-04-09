package com.fern.events.core;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * Standard envelope for all Kafka events in the FERN system.
 * Wraps any payload type with metadata for tracing, versioning, and replay.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EventEnvelope<T>(
    String eventId,
    String aggregateId,
    String eventType,
    Instant timestamp,
    String sourceComponent,
    int version,
    T payload
) {
    public static <T> EventEnvelope<T> create(String eventType, String aggregateId, T payload, String sourceComponent) {
        return new EventEnvelope<>(
            java.util.UUID.randomUUID().toString(),
            aggregateId,
            eventType,
            Instant.now(),
            sourceComponent,
            1,
            payload
        );
    }
}
