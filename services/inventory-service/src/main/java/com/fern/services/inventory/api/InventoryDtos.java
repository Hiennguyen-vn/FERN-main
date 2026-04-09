package com.fern.services.inventory.api;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class InventoryDtos {

  private InventoryDtos() {
  }

  public record StockBalanceView(
      long outletId,
      long itemId,
      String itemCode,
      String itemName,
      String categoryCode,
      String baseUomCode,
      BigDecimal qtyOnHand,
      BigDecimal unitCost,
      LocalDate lastCountDate,
      Instant updatedAt
  ) {
  }

  public record InventoryTransactionView(
      long id,
      long outletId,
      long itemId,
      String itemCode,
      String itemName,
      BigDecimal qtyChange,
      LocalDate businessDate,
      Instant txnTime,
      String txnType,
      BigDecimal unitCost,
      Long createdByUserId,
      String wasteReason,
      String note,
      Instant createdAt
  ) {
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record CreateWasteRequest(
      @NotNull Long outletId,
      @NotNull Long itemId,
      @NotNull @DecimalMin(value = "0.0001") BigDecimal quantity,
      @NotNull LocalDate businessDate,
      @DecimalMin(value = "0.00") BigDecimal unitCost,
      @NotBlank String reason,
      String note
  ) {
  }

  public record WasteView(
      long inventoryTransactionId,
      String reason,
      Long approvedByUserId,
      InventoryTransactionView transaction
  ) {
  }

  public record StockCountLineRequest(
      @NotNull Long itemId,
      @NotNull @DecimalMin(value = "0.00") BigDecimal actualQty,
      String note
  ) {
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record CreateStockCountSessionRequest(
      @NotNull Long outletId,
      @NotNull LocalDate countDate,
      String note,
      @NotNull @NotEmpty List<@Valid StockCountLineRequest> lines
  ) {
  }

  public record StockCountLineView(
      long id,
      long itemId,
      BigDecimal systemQty,
      BigDecimal actualQty,
      BigDecimal varianceQty,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record StockCountSessionView(
      long id,
      long outletId,
      LocalDate countDate,
      String status,
      String note,
      Long countedByUserId,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt,
      List<StockCountLineView> lines
  ) {
  }

  public record StockCountSessionListItemView(
      long id,
      long outletId,
      LocalDate countDate,
      String status,
      String note,
      Long countedByUserId,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt,
      long totalItems,
      long countedItems,
      long varianceItems,
      BigDecimal varianceValue
  ) {
  }
}
