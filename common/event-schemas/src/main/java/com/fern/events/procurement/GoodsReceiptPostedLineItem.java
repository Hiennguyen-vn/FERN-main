package com.fern.events.procurement;

import java.math.BigDecimal;

public record GoodsReceiptPostedLineItem(
    long itemId,
    String uomCode,
    BigDecimal quantity,
    BigDecimal unitCost,
    BigDecimal lineTotal
) {
}
