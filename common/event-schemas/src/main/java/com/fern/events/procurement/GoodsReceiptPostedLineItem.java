package com.fern.events.procurement;

import java.math.BigDecimal;
import java.time.LocalDate;

public record GoodsReceiptPostedLineItem(
    long itemId,
    String uomCode,
    BigDecimal quantity,
    BigDecimal unitCost,
    BigDecimal lineTotal,
    String batchNo,
    LocalDate expiryDate
) {
  public GoodsReceiptPostedLineItem(long itemId, String uomCode, BigDecimal quantity,
                                     BigDecimal unitCost, BigDecimal lineTotal) {
    this(itemId, uomCode, quantity, unitCost, lineTotal, null, null);
  }
}
