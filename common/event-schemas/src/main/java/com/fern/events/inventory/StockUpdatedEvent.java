package com.fern.events.inventory;

import java.math.BigDecimal;
import java.time.Instant;

public record StockUpdatedEvent(
    long outletId,
    long productId,
    BigDecimal previousBalance,
    BigDecimal newBalance,
    String currencyCode,
    Instant updatedAt
) {}
