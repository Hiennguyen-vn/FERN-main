package com.fern.events.org;

import java.time.Instant;

public record RegionCreatedEvent(
    long regionId,
    String code,
    Long parentRegionId,
    String currencyCode,
    String name,
    String taxCode,
    String timezoneName,
    Instant createdAt,
    Long createdByUserId
) {
}
