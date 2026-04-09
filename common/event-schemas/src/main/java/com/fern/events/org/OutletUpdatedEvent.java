package com.fern.events.org;

import java.time.Instant;

public record OutletUpdatedEvent(
    long outletId,
    String regionCode,
    String status,
    String name,
    Instant updatedAt
) {
}
