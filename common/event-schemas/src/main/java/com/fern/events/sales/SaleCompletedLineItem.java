package com.fern.events.sales;

import java.math.BigDecimal;

public record SaleCompletedLineItem(
    long productId,
    BigDecimal quantity,
    BigDecimal unitPrice,
    BigDecimal discountAmount,
    BigDecimal taxAmount,
    BigDecimal lineTotal
) {
}
