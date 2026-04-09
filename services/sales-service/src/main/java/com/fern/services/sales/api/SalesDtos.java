package com.fern.services.sales.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

public final class SalesDtos {

  private SalesDtos() {
  }

  public record PosSessionView(
      String id,
      String sessionCode,
      long outletId,
      String currencyCode,
      long managerId,
      Instant openedAt,
      Instant closedAt,
      LocalDate businessDate,
      String status,
      String note
  ) {
  }

  public record PosSessionListItemView(
      String id,
      String sessionCode,
      long outletId,
      String currencyCode,
      long managerId,
      Instant openedAt,
      Instant closedAt,
      LocalDate businessDate,
      String status,
      String note,
      long orderCount,
      BigDecimal totalRevenue
  ) {
  }

  public record OrderingTableLinkView(
      String tableToken,
      String tableCode,
      String tableName,
      String status,
      long outletId,
      String outletCode,
      String outletName
  ) {
  }

  public record OrderingTableDetailView(
      long tableId,
      String tableToken,
      String tableCode,
      String tableName,
      String status,
      long outletId,
      String outletCode,
      String outletName,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record CreateOrderingTableRequest(
      @NotNull Long outletId,
      @NotBlank String tableCode,
      @NotBlank String tableName,
      String status
  ) {
  }

  public record UpdateOrderingTableRequest(
      String tableName,
      String status
  ) {
  }

  public record OpenPosSessionRequest(
      @NotBlank String sessionCode,
      @NotNull Long outletId,
      @NotBlank String currencyCode,
      @NotNull Long managerId,
      @NotNull LocalDate businessDate,
      String note
  ) {
  }

  public record SaleLineRequest(
      @NotNull Long productId,
      @NotNull @DecimalMin("0.0001") BigDecimal quantity,
      BigDecimal discountAmount,
      BigDecimal taxAmount,
      String note,
      Set<Long> promotionIds
  ) {
  }

  public record PaymentRequest(
      @NotBlank String paymentMethod,
      @NotNull @DecimalMin("0.00") BigDecimal amount,
      String status,
      Instant paymentTime,
      String transactionRef,
      String note
  ) {
  }

  public record MarkPaymentDoneRequest(
      @NotBlank String paymentMethod,
      @NotNull @DecimalMin("0.00") BigDecimal amount,
      Instant paymentTime,
      String transactionRef,
      String note
  ) {
  }

  public record SubmitSaleRequest(
      @NotNull Long outletId,
      Long posSessionId,
      @NotBlank String currencyCode,
      String orderType,
      String note,
      @NotEmpty List<@Valid SaleLineRequest> items,
      @Valid PaymentRequest payment
  ) {
  }

  public record SaleLineView(
      long productId,
      String productCode,
      String productName,
      BigDecimal quantity,
      BigDecimal unitPrice,
      BigDecimal discountAmount,
      BigDecimal taxAmount,
      BigDecimal lineTotal,
      Set<Long> promotionIds,
      String note
  ) {
  }

  public record PaymentView(
      String saleId,
      String paymentMethod,
      BigDecimal amount,
      String status,
      Instant paymentTime,
      String transactionRef,
      String note
  ) {
  }

  public record SaleView(
      String id,
      long outletId,
      String posSessionId,
      String publicOrderToken,
      String orderingTableCode,
      String orderingTableName,
      String currencyCode,
      String orderType,
      String status,
      String paymentStatus,
      BigDecimal subtotal,
      BigDecimal discount,
      BigDecimal taxAmount,
      BigDecimal totalAmount,
      String note,
      List<SaleLineView> items,
      PaymentView payment,
      Instant createdAt
  ) {
  }

  public record SaleListItemView(
      String id,
      long outletId,
      String posSessionId,
      String publicOrderToken,
      String orderingTableCode,
      String orderingTableName,
      String currencyCode,
      String orderType,
      String status,
      String paymentStatus,
      BigDecimal subtotal,
      BigDecimal discount,
      BigDecimal taxAmount,
      BigDecimal totalAmount,
      String note,
      Instant createdAt
  ) {
  }

  public record ClosePosSessionRequest(String note) {
  }

  public record ReconcilePosSessionLineRequest(
      @NotBlank String paymentMethod,
      @NotNull @DecimalMin("0.00") BigDecimal actualAmount
  ) {
  }

  public record ReconcilePosSessionRequest(
      List<@Valid ReconcilePosSessionLineRequest> lines,
      String note
  ) {
  }

  public record PosSessionReconciliationLineView(
      String paymentMethod,
      BigDecimal expectedAmount,
      BigDecimal actualAmount,
      BigDecimal discrepancyAmount
  ) {
  }

  public record PosSessionReconciliationView(
      String sessionId,
      String sessionCode,
      long outletId,
      LocalDate businessDate,
      String status,
      Instant openedAt,
      Instant closedAt,
      Instant reconciledAt,
      BigDecimal expectedTotal,
      BigDecimal actualTotal,
      BigDecimal discrepancyTotal,
      String note,
      List<PosSessionReconciliationLineView> lines
  ) {
  }

  public record CancelSaleRequest(String reason) {
  }

  public record CreatePromotionRequest(
      @NotBlank String name,
      @NotBlank String promoType,
      BigDecimal valueAmount,
      BigDecimal valuePercent,
      BigDecimal minOrderAmount,
      BigDecimal maxDiscountAmount,
      @NotNull Instant effectiveFrom,
      Instant effectiveTo,
      Set<Long> outletIds
  ) {
  }

  public record PromotionView(
      String id,
      String name,
      String promoType,
      String status,
      BigDecimal valueAmount,
      BigDecimal valuePercent,
      Instant effectiveFrom,
      Instant effectiveTo,
      Set<Long> outletIds
  ) {
  }

  public record OutletHourlyRevenuePoint(
      String hour,
      BigDecimal revenue
  ) {
  }

  public record OutletStatsView(
      long outletId,
      LocalDate businessDate,
      long ordersToday,
      long completedSales,
      long cancelledOrders,
      BigDecimal revenueToday,
      BigDecimal averageOrderValue,
      String activeSessionCode,
      String activeSessionStatus,
      String topCategory,
      String peakHour,
      List<OutletHourlyRevenuePoint> hourlyRevenue
  ) {
  }
}
