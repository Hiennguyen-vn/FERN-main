package com.fern.events.sales;

import java.time.Instant;
import java.time.LocalDate;

public record SaleCancelledEvent(
    long saleId,
    long outletId,
    LocalDate businessDate,
    Instant saleCreatedAt,
    Long cancelledByUserId,
    String reason,
    Instant cancelledAt
) {
}
