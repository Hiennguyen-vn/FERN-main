package com.fern.events.sales;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record SaleApprovedEvent(
    long saleId,
    long outletId,
    LocalDate businessDate,
    Instant saleCreatedAt,
    Long approvedByUserId,
    boolean allowOversell,
    boolean oversell,
    List<SaleCompletedLineItem> lineItems,
    Instant approvedAt
) {
}
