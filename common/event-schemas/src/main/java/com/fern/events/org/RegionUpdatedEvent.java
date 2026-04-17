package com.fern.events.org;

import java.time.Instant;

public record RegionUpdatedEvent(
    long regionId,
    String code,
    Long parentRegionId,
    String currencyCode,
    String name,
    String taxCode,
    String timezoneName,
    Instant updatedAt,
    Long updatedByUserId
) {
}
