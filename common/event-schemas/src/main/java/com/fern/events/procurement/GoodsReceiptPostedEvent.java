package com.fern.events.procurement;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record GoodsReceiptPostedEvent(
    long goodsReceiptId,
    long purchaseOrderId,
    long supplierId,
    long outletId,
    LocalDate businessDate,
    String currencyCode,
    List<GoodsReceiptPostedLineItem> lineItems,
    BigDecimal totalPrice,
    Instant postedAt
) {
}
