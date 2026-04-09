package com.fern.events.auth;

import java.time.Instant;
import java.util.Set;

public record RoleUpdatedEvent(
    String roleCode,
    Set<String> permissionCodes,
    Instant updatedAt,
    Long updatedByUserId
) {
}
