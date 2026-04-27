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

  public record MonthlyExpenseRow(
      long outletId,
      String month,
      String sourceType,
      long recordCount,
      BigDecimal amount,
      String currencyCode
  ) {
  }

  public record InvoiceLineView(
      int lineNo,
      String productCode,
      String productName,
      String unit,
      java.math.BigDecimal qty,
      long unitPriceCents,
      long discountCents,
      java.math.BigDecimal vatPercent,
      long vatCents,
      long amountCents
  ) {}

  public record InvoiceView(
      long id,
      long outletId,
      long saleId,
      String invoiceNumber,
      Instant issuedAt,
      String sellerTaxCode,
      String sellerName,
      String sellerAddress,
      String buyerName,
      String buyerPhone,
      long subtotalCents,
      long vatCents,
      long totalCents,
      String totalInWords,
      String paymentMethod,
      String currency,
      String cqtStatus,
      String templateVersion,
      java.util.List<InvoiceLineView> lines
  ) {}

  public record InvoiceSummary(
      long id,
      long outletId,
      long saleId,
      String invoiceNumber,
      Instant issuedAt,
      long totalCents,
      String cqtStatus
  ) {}

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
