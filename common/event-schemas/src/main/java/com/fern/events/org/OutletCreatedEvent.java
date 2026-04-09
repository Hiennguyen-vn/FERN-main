package com.fern.events.org;

import java.time.Instant;
import java.time.LocalDate;

public record OutletCreatedEvent(
    long outletId,
    long regionId,
    String code,
    String name,
    String status,
    LocalDate openedAt,
    Instant createdAt,
    Long createdByUserId
) {
}
