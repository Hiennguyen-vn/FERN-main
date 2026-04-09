package com.fern.events.inventory;

import java.math.BigDecimal;
import java.time.Instant;

public record StockLowThresholdEvent(
    long outletId,
    long itemId,
    BigDecimal qtyOnHand,
    BigDecimal reorderThreshold,
    Instant observedAt
) {
}
