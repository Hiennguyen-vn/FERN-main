package com.fern.events.finance;

import java.math.BigDecimal;
import java.time.Instant;

public record ExpenseRecordCreatedEvent(
    long expenseId,
    long sourceId,
    BigDecimal amount,
    String currencyCode,
    Instant createdAt
) {}
