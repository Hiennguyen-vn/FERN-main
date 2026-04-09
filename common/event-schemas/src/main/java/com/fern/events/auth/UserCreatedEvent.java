package com.fern.events.auth;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

public record UserCreatedEvent(
    long userId,
    String username,
    String fullName,
    String employeeCode,
    String status,
    Map<Long, Set<String>> rolesByOutlet,
    Map<Long, Set<String>> permissionsByOutlet,
    Instant createdAt,
    Long createdByUserId
) {
}
