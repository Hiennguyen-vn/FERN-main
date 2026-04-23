package com.dorabets.common.outbox;

import java.time.Instant;

public record OutboxEvent(
    long id,
    String aggregateType,
    long aggregateId,
    String topic,
    String eventKey,
    String payload,        // JSON string
    String headers,        // JSON string or null
    Instant createdAt,
    String status,
    int attemptCount,
    Instant retryAfter,
    String lastError
) {}
