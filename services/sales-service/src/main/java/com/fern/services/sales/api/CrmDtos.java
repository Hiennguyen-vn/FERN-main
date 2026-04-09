package com.fern.services.sales.api;

import java.math.BigDecimal;
import java.time.Instant;

public final class CrmDtos {

  private CrmDtos() {
  }

  public record CustomerView(
      String id,
      String referenceType,
      String displayName,
      long outletId,
      String outletCode,
      String outletName,
      long orderCount,
      BigDecimal totalSpend,
      Instant lastOrderAt
  ) {
  }
}
