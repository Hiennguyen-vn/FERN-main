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

public final class PublicPosDtos {

  private PublicPosDtos() {
  }

  public record PublicTableView(
      String tableToken,
      String tableCode,
      String tableName,
      String status,
      String outletCode,
      String outletName,
      String currencyCode,
      String timezoneName,
      LocalDate businessDate
  ) {
  }

  public record PublicMenuItemView(
      String productId,
      String code,
      String name,
      String categoryCode,
      String description,
      String imageUrl,
      BigDecimal priceValue,
      String currencyCode
  ) {
  }

  public record PublicOrderLineRequest(
      @NotBlank String productId,
      @NotNull @DecimalMin("0.0001") BigDecimal quantity,
      String note
  ) {
  }

  public record CreatePublicOrderRequest(
      @NotEmpty List<@Valid PublicOrderLineRequest> items,
      String note
  ) {
  }

  public record PublicOrderLineView(
      String productId,
      String productCode,
      String productName,
      BigDecimal quantity,
      BigDecimal unitPrice,
      BigDecimal lineTotal,
      String note
  ) {
  }

  public record PublicOrderReceiptView(
      String orderToken,
      String tableCode,
      String tableName,
      String outletCode,
      String outletName,
      String currencyCode,
      String orderStatus,
      String paymentStatus,
      BigDecimal totalAmount,
      String note,
      Instant createdAt,
      List<PublicOrderLineView> items
  ) {
  }
}
