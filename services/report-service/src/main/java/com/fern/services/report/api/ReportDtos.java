package com.fern.services.report.api;

import java.math.BigDecimal;
import java.time.LocalDate;

public final class ReportDtos {

  private ReportDtos() {
  }

  public record SalesSummary(
      long outletId,
      LocalDate businessDate,
      long saleCount,
      BigDecimal subtotal,
      BigDecimal discount,
      BigDecimal taxAmount,
      BigDecimal totalAmount
  ) {
  }

  public record ExpenseSummary(
      long outletId,
      LocalDate businessDate,
      String sourceType,
      long expenseCount,
      BigDecimal totalAmount
  ) {
  }

  public record InventoryMovementSummary(
      long outletId,
      long itemId,
      LocalDate businessDate,
      String txnType,
      BigDecimal netQuantityChange
  ) {
  }

  public record LowStockSnapshot(
      long outletId,
      long itemId,
      String itemCode,
      String itemName,
      BigDecimal qtyOnHand,
      BigDecimal minStockLevel
  ) {
  }
}
