package com.fern.events.product;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record ProductPriceChangedEvent(
    long productId,
    long outletId,
    String currencyCode,
    BigDecimal oldPrice,
    BigDecimal newPrice,
    LocalDate effectiveFrom,
    Long updatedByUserId,
    Instant updatedAt
) {
}
