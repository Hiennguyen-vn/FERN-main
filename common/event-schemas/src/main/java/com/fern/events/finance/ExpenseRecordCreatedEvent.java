package com.fern.events.finance;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record ExpenseRecordCreatedEvent(
    long expenseId,
    long sourceId,
    BigDecimal amount,
    String currencyCode,
    Instant createdAt,
    long expenseRecordId,
    Long outletId,
    Long actorUserId,
    String actorUsername,
    List<String> actorRoles,
    String correlationId,
    String sourceEventId
) {
  public ExpenseRecordCreatedEvent(
      long expenseId,
      long sourceId,
      BigDecimal amount,
      String currencyCode,
      Instant createdAt
  ) {
    this(
        expenseId,
        sourceId,
        amount,
        currencyCode,
        createdAt,
        expenseId,
        null,
        null,
        null,
        List.of(),
        null,
        null
    );
  }

  public ExpenseRecordCreatedEvent {
    actorRoles = actorRoles == null ? List.of() : List.copyOf(actorRoles);
  }
}
