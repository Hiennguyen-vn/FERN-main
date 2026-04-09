package com.fern.events.auth;

import java.time.Instant;
import java.util.List;

public record UserRoleChangedEvent(
    long userId,
    Long outletId,
    List<String> roles,
    List<String> permissions,
    Instant changedAt,
    Long changedByUserId
) {
}
