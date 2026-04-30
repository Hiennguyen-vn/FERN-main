package com.fern.services.finance.api;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

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
      String note,
      Long createdByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record ExpenseDocumentView(
      long id,
      long expenseId,
      String documentType,
      String fileName,
      String contentType,
      String objectKey,
      String url,
      Long createdByUserId,
      Instant createdAt
  ) {
  }

  public record ExpenseDetailView(
      ExpenseView expense,
      List<ExpenseDocumentView> documents,
      SupplierInvoiceExpenseDetailView supplierInvoice,
      List<SupplierInvoiceExpenseDetailView> supplierInvoices,
      InventoryReceiptExpenseDetailView inventoryReceipt
  ) {
  }

  public record InventoryReceiptExpenseLineView(
      Long goodsReceiptItemId,
      Long itemId,
      String itemCode,
      String itemName,
      String uomCode,
      BigDecimal qtyReceived,
      BigDecimal unitCost,
      BigDecimal lineTotal,
      LocalDate manufactureDate,
      LocalDate expiryDate,
      String note
  ) {
  }

  public record InventoryReceiptExpenseDetailView(
      Long goodsReceiptId,
      Long purchaseOrderId,
      String purchaseOrderStatus,
      Long supplierId,
      String supplierCode,
      String supplierName,
      String currencyCode,
      String receiptStatus,
      Instant receiptTime,
      LocalDate receiptBusinessDate,
      BigDecimal receiptTotal,
      String supplierLotNumber,
      List<InventoryReceiptExpenseLineView> lines
  ) {
  }

  public record SupplierInvoiceExpenseLineView(
      int lineNumber,
      String lineType,
      Long goodsReceiptItemId,
      Long itemId,
      String itemCode,
      String itemName,
      String uomCode,
      BigDecimal qtyInvoiced,
      BigDecimal unitPrice,
      BigDecimal taxPercent,
      BigDecimal taxAmount,
      BigDecimal lineTotal,
      BigDecimal qtyReceived,
      BigDecimal receiptUnitCost,
      BigDecimal receiptLineTotal,
      String description,
      String note
  ) {
  }

  public record SupplierInvoiceExpenseDetailView(
      Long invoiceId,
      String invoiceNumber,
      Long supplierId,
      String supplierCode,
      String supplierName,
      String currencyCode,
      LocalDate invoiceDate,
      LocalDate dueDate,
      BigDecimal subtotal,
      BigDecimal taxAmount,
      BigDecimal totalAmount,
      String status,
      String note,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt,
      Long goodsReceiptId,
      Long purchaseOrderId,
      String purchaseOrderStatus,
      String receiptStatus,
      Instant receiptTime,
      LocalDate receiptBusinessDate,
      BigDecimal receiptTotal,
      String supplierLotNumber,
      List<SupplierInvoiceExpenseLineView> lines
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

  public record ExpenseSummaryRow(
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
