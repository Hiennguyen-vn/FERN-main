package com.fern.events.sales;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record InventoryOversellEvent(
    long saleId,
    long outletId,
    String currencyCode,
    List<OversellShortage> shortages,
    Instant detectedAt
) {

  public record OversellShortage(
      long itemId,
      Long productId,
      BigDecimal requiredQty,
      BigDecimal availableQty,
      BigDecimal shortQty
  ) {
  }
}
