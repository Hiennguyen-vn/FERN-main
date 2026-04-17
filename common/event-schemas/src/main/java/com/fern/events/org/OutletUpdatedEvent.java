package com.fern.events.org;

import java.time.Instant;
import java.time.LocalDate;

public record OutletUpdatedEvent(
    long outletId,
    long regionId,
    String code,
    String status,
    String name,
    String address,
    String phone,
    String email,
    LocalDate openedAt,
    LocalDate closedAt,
    String reason,
    Instant updatedAt,
    Long updatedByUserId
) {
}
