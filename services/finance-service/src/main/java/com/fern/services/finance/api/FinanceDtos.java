package com.fern.services.finance.api;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public final class FinanceDtos {

  private FinanceDtos() {
  }

  public record ExpenseView(
      long id,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String sourceType,
      String subtype,
      String description,
      Long createdByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record CreateOperatingExpenseRequest(
      @NotNull Long outletId,
      @NotNull LocalDate businessDate,
      @NotBlank String currencyCode,
      @NotNull @DecimalMin(value = "0.00") BigDecimal amount,
      @NotBlank String description,
      String note
  ) {
  }

  public record CreateOtherExpenseRequest(
      @NotNull Long outletId,
      @NotNull LocalDate businessDate,
      @NotBlank String currencyCode,
      @NotNull @DecimalMin(value = "0.00") BigDecimal amount,
      @NotBlank String description,
      String note
  ) {
  }
}
