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
    Instant postedAt,
    Long actorUserId,
    String actorUsername,
    List<String> actorRoles,
    String correlationId
) {
  public GoodsReceiptPostedEvent(
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
    this(
        goodsReceiptId,
        purchaseOrderId,
        supplierId,
        outletId,
        businessDate,
        currencyCode,
        lineItems,
        totalPrice,
        postedAt,
        null,
        null,
        List.of(),
        null
    );
  }

  public GoodsReceiptPostedEvent {
    lineItems = lineItems == null ? List.of() : List.copyOf(lineItems);
    actorRoles = actorRoles == null ? List.of() : List.copyOf(actorRoles);
  }
}
