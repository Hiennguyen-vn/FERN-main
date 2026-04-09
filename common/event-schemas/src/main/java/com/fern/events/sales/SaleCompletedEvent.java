package com.fern.events.sales;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record SaleCompletedEvent(
    long saleId,
    long outletId,
    LocalDate businessDate,
    String currencyCode,
    List<SaleCompletedLineItem> lineItems,
    BigDecimal subtotal,
    BigDecimal discount,
    BigDecimal taxAmount,
    BigDecimal totalAmount,
    Instant completedAt
) {
}
