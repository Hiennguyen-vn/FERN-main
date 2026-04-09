package com.fern.events.audit;

import java.time.Instant;

public record AuditEvent(
    long id,
    long actorUserId,
    String action,
    String entityName,
    long entityId,
    String details,
    Instant createdAt
) {}
