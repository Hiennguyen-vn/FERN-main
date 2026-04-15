package com.fern.services.product.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class ProductDtos {

  private ProductDtos() {
  }

  public record ProductView(
      long id,
      String code,
      String name,
      String categoryCode,
      String status,
      String imageUrl,
      String description
  ) {
  }

  public record ItemView(
      long id,
      String code,
      String name,
      String categoryCode,
      String baseUomCode,
      BigDecimal minStockLevel,
      BigDecimal maxStockLevel,
      String status
  ) {
  }

  public record PriceView(
      long productId,
      long outletId,
      String currencyCode,
      BigDecimal priceValue,
      LocalDate effectiveFrom,
      LocalDate effectiveTo
  ) {
  }

  public record RecipeLineView(
      long itemId,
      String uomCode,
      BigDecimal qty
  ) {
  }

  public record RecipeView(
      long productId,
      String version,
      BigDecimal yieldQty,
      String yieldUomCode,
      String status,
      List<RecipeLineView> items
  ) {
  }

  public record CreateProductRequest(
      @NotBlank String code,
      @NotBlank String name,
      String categoryCode,
      String imageUrl,
      String description
  ) {
  }

  public record CreateItemRequest(
      @NotBlank String code,
      @NotBlank String name,
      String categoryCode,
      @NotBlank String baseUomCode,
      BigDecimal minStockLevel,
      BigDecimal maxStockLevel
  ) {
  }

  public record UpsertPriceRequest(
      @NotNull Long productId,
      @NotNull Long outletId,
      @NotBlank String currencyCode,
      @NotNull BigDecimal priceValue,
      @NotNull LocalDate effectiveFrom,
      LocalDate effectiveTo
  ) {
  }

  public record RecipeLineRequest(
      @NotNull Long itemId,
      @NotBlank String uomCode,
      @NotNull BigDecimal qty
  ) {
  }

  public record UpsertRecipeRequest(
      @NotBlank String version,
      @NotNull BigDecimal yieldQty,
      @NotBlank String yieldUomCode,
      String status,
      @NotEmpty List<@Valid RecipeLineRequest> items
  ) {
  }

  public record UpdateProductRequest(
      String name,
      String categoryCode,
      String status,
      String imageUrl,
      String description
  ) {
  }

  public record UpdateItemRequest(
      String name,
      String categoryCode,
      String baseUomCode,
      BigDecimal minStockLevel,
      BigDecimal maxStockLevel,
      String status
  ) {
  }

  public record AvailabilityView(
      long productId,
      long outletId,
      boolean available
  ) {
  }

  public record SetAvailabilityRequest(
      @NotNull Long productId,
      @NotNull Long outletId,
      boolean available
  ) {
  }

  public record CategoryView(String code, String name, boolean isActive, String description) {}

  public record CreateCategoryRequest(@NotBlank String code, @NotBlank String name, String description) {}

  public record UpdateCategoryRequest(String name, String description, Boolean isActive) {}

  // ── Menu ──────────────────────────────────────────────

  public record MenuView(
      long id,
      String code,
      String name,
      String description,
      String status,
      String scopeType,
      Long scopeId,
      List<MenuCategoryView> categories
  ) {}

  public record MenuCategoryView(
      long id,
      String code,
      String name,
      int displayOrder,
      List<MenuItemView> items
  ) {}

  public record MenuItemView(
      long id,
      long productId,
      String productCode,
      String productName,
      String productStatus,
      int displayOrder,
      boolean isActive
  ) {}

  public record CreateMenuRequest(
      @NotBlank String code,
      @NotBlank String name,
      String description,
      String scopeType,
      Long scopeId
  ) {}

  public record UpdateMenuRequest(
      String name,
      String description,
      String status
  ) {}

  public record AddMenuCategoryRequest(
      @NotBlank String code,
      @NotBlank String name,
      int displayOrder
  ) {}

  public record AddMenuItemRequest(
      @NotNull Long productId,
      int displayOrder
  ) {}

  public record MenuItemExclusionView(
      long menuItemId,
      long outletId,
      String reason
  ) {}

  public record SetMenuItemExclusionRequest(
      @NotNull Long menuItemId,
      @NotNull Long outletId,
      String reason
  ) {}

  // ── Channel & Daypart ─────────────────────────────────

  public record ChannelView(String code, String name, boolean isActive, int displayOrder) {}

  public record DaypartView(String code, String name, String startTime, String endTime, boolean isActive, int displayOrder) {}
}
