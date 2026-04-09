package com.fern.events.sales;

import java.math.BigDecimal;
import java.time.Instant;

public record PaymentCapturedEvent(
    long saleId,
    String paymentMethod,
    BigDecimal amount,
    String currencyCode,
    Instant paymentTime,
    String transactionRef
) {
}
