package com.fern.services.procurement.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class ProcurementDtos {

  private ProcurementDtos() {
  }

  public record PurchaseOrderItemRequest(
      @NotNull Long itemId,
      @NotBlank String uomCode,
      @DecimalMin(value = "0.00") BigDecimal expectedUnitPrice,
      @NotNull @DecimalMin(value = "0.0001") BigDecimal qtyOrdered,
      String note
  ) {
  }

  public record CreateSupplierRequest(
      Long regionId,
      @NotBlank String supplierCode,
      @NotBlank String name,
      String taxCode,
      String address,
      String phone,
      String email,
      String contactPerson,
      @NotBlank String status
  ) {
  }

  public record UpdateSupplierRequest(
      Long regionId,
      @NotBlank String name,
      String taxCode,
      String address,
      String phone,
      String email,
      String contactPerson,
      @NotBlank String status
  ) {
  }

  public record SupplierView(
      long id,
      Long regionId,
      String supplierCode,
      String name,
      String taxCode,
      String address,
      String phone,
      String email,
      String contactPerson,
      String status,
      Instant deletedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record CreatePurchaseOrderRequest(
      @NotNull Long supplierId,
      @NotNull Long outletId,
      @NotBlank String currencyCode,
      @NotNull LocalDate orderDate,
      LocalDate expectedDeliveryDate,
      String note,
      @NotNull @NotEmpty List<@Valid PurchaseOrderItemRequest> items
  ) {
  }

  public record PurchaseOrderItemView(
      long itemId,
      String uomCode,
      BigDecimal expectedUnitPrice,
      BigDecimal qtyOrdered,
      BigDecimal qtyReceived,
      String status,
      String note
  ) {
  }

  public record PurchaseOrderView(
      long id,
      long supplierId,
      long outletId,
      String currencyCode,
      LocalDate orderDate,
      LocalDate expectedDeliveryDate,
      BigDecimal expectedTotal,
      String status,
      String note,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt,
      List<PurchaseOrderItemView> items
  ) {
  }

  public record PurchaseOrderListItemView(
      long id,
      long supplierId,
      long outletId,
      String currencyCode,
      LocalDate orderDate,
      LocalDate expectedDeliveryDate,
      BigDecimal expectedTotal,
      String status,
      String note,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record GoodsReceiptItemRequest(
      @NotNull Long itemId,
      @NotBlank String uomCode,
      @NotNull @DecimalMin(value = "0.0001") BigDecimal qtyReceived,
      @NotNull @DecimalMin(value = "0.00") BigDecimal unitCost,
      LocalDate manufactureDate,
      LocalDate expiryDate,
      String note
  ) {
  }

  public record CreateGoodsReceiptRequest(
      @NotNull Long poId,
      @NotBlank String currencyCode,
      @NotNull LocalDate businessDate,
      @NotNull @DecimalMin(value = "0.00") BigDecimal totalPrice,
      String supplierLotNumber,
      String note,
      @NotNull @NotEmpty List<@Valid GoodsReceiptItemRequest> items
  ) {
  }

  public record GoodsReceiptItemView(
      long id,
      long itemId,
      String uomCode,
      BigDecimal qtyReceived,
      BigDecimal unitCost,
      BigDecimal lineTotal,
      LocalDate manufactureDate,
      LocalDate expiryDate,
      String note
  ) {
  }

  public record GoodsReceiptView(
      long id,
      long poId,
      String currencyCode,
      Instant receiptTime,
      LocalDate businessDate,
      String status,
      String note,
      BigDecimal totalPrice,
      String supplierLotNumber,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt,
      List<GoodsReceiptItemView> items
  ) {
  }

  public record GoodsReceiptListItemView(
      long id,
      long poId,
      long outletId,
      String currencyCode,
      Instant receiptTime,
      LocalDate businessDate,
      String status,
      BigDecimal totalPrice,
      String supplierLotNumber,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record SupplierInvoiceItemRequest(
      @NotBlank String lineType,
      Long goodsReceiptItemId,
      String description,
      @DecimalMin(value = "0.0001") BigDecimal qtyInvoiced,
      @DecimalMin(value = "0.00") BigDecimal unitPrice,
      @DecimalMin(value = "0.00") BigDecimal taxPercent,
      @NotNull @DecimalMin(value = "0.00") BigDecimal taxAmount,
      @NotNull @DecimalMin(value = "0.00") BigDecimal lineTotal,
      String note
  ) {
  }

  public record CreateSupplierInvoiceRequest(
      @NotBlank String invoiceNumber,
      @NotNull Long supplierId,
      @NotBlank String currencyCode,
      @NotNull LocalDate invoiceDate,
      LocalDate dueDate,
      @NotNull @DecimalMin(value = "0.00") BigDecimal subtotal,
      @NotNull @DecimalMin(value = "0.00") BigDecimal taxAmount,
      @NotNull @DecimalMin(value = "0.00") BigDecimal totalAmount,
      String note,
      @NotNull @NotEmpty List<Long> linkedReceiptIds,
      @NotNull @NotEmpty List<@Valid SupplierInvoiceItemRequest> items
  ) {
  }

  public record SupplierInvoiceItemView(
      int lineNumber,
      String lineType,
      Long goodsReceiptItemId,
      String description,
      BigDecimal qtyInvoiced,
      BigDecimal unitPrice,
      BigDecimal taxPercent,
      BigDecimal taxAmount,
      BigDecimal lineTotal,
      String note
  ) {
  }

  public record SupplierInvoiceView(
      long id,
      String invoiceNumber,
      long supplierId,
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
      List<Long> linkedReceiptIds,
      List<SupplierInvoiceItemView> items
  ) {
  }

  public record SupplierInvoiceListItemView(
      long id,
      String invoiceNumber,
      long supplierId,
      long outletId,
      String currencyCode,
      LocalDate invoiceDate,
      LocalDate dueDate,
      BigDecimal totalAmount,
      String status,
      String note,
      Long createdByUserId,
      Long approvedByUserId,
      Instant approvedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PaymentAllocationRequest(
      @NotNull Long invoiceId,
      @NotNull @DecimalMin(value = "0.01") BigDecimal allocatedAmount,
      String note
  ) {
  }

  public record CreateSupplierPaymentRequest(
      @NotNull Long supplierId,
      @NotBlank String currencyCode,
      @NotBlank String paymentMethod,
      @NotNull @DecimalMin(value = "0.01") BigDecimal amount,
      @NotNull Instant paymentTime,
      String transactionRef,
      String note,
      @NotNull @NotEmpty List<@Valid PaymentAllocationRequest> allocations
  ) {
  }

  public record SupplierPaymentAllocationView(
      long invoiceId,
      BigDecimal allocatedAmount,
      String note
  ) {
  }

  public record SupplierPaymentView(
      String id,
      long supplierId,
      String currencyCode,
      String paymentMethod,
      BigDecimal amount,
      String status,
      Instant paymentTime,
      String transactionRef,
      String note,
      Long createdByUserId,
      Instant createdAt,
      Instant updatedAt,
      List<SupplierPaymentAllocationView> allocations
  ) {
  }

  public record SupplierPaymentListItemView(
      String id,
      long supplierId,
      long outletId,
      String currencyCode,
      String paymentMethod,
      BigDecimal amount,
      String status,
      Instant paymentTime,
      String transactionRef,
      String note,
      Long createdByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }
}
