package com.fern.events.org;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record ExchangeRateUpdatedEvent(
    String fromCurrencyCode,
    String toCurrencyCode,
    BigDecimal rate,
    LocalDate effectiveFrom,
    LocalDate effectiveTo,
    Instant updatedAt,
    Long updatedByUserId
) {
}
