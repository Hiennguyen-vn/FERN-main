package com.fern.common.sync;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

public final class SyncPayloadSchemas {

  private SyncPayloadSchemas() {
  }

  public record ProductPayload(
      long productId,
      String code,
      String name,
      String categoryCode,
      String status,
      String imageUrl,
      String description,
      boolean deleted,
      long version,
      Instant updatedAt
  ) {
  }

  public record CategoryPayload(
      String code,
      String name,
      boolean active,
      String description,
      long version,
      Instant updatedAt
  ) {
  }

  public record PricePolicyPayload(
      long productId,
      long outletId,
      String currencyCode,
      BigDecimal priceValue,
      LocalDate effectiveFrom,
      LocalDate effectiveTo,
      long version,
      Instant updatedAt
  ) {
  }

  public record ItemAvailabilityPayload(
      long productId,
      long outletId,
      boolean available,
      long version,
      Instant updatedAt
  ) {
  }

  public record StoreConfigPayload(
      long storeId,
      long regionId,
      String code,
      String name,
      String status,
      String address,
      String phone,
      String email,
      LocalDate openedAt,
      LocalDate closedAt,
      long version,
      Instant updatedAt
  ) {
  }

  public record PromotionPayload(
      long promotionId,
      String name,
      String promoType,
      String status,
      BigDecimal valueAmount,
      BigDecimal valuePercent,
      Instant effectiveFrom,
      Instant effectiveTo,
      Set<Long> outletIds,
      BxgyRulePayload bxgyRule,
      ComboRulePayload comboRule,
      SubsidyRulePayload subsidyRule,
      long version,
      Instant updatedAt
  ) {
    public PromotionPayload {
      outletIds = outletIds == null ? Set.of() : Set.copyOf(outletIds);
    }
  }

  public record BxgyRulePayload(
      long buyProductId,
      BigDecimal buyQty,
      long getProductId,
      BigDecimal getQty,
      BigDecimal getDiscountPercent
  ) {}

  public record ComboRulePayload(
      BigDecimal comboPrice,
      List<ComboRuleItemPayload> items
  ) {
    public ComboRulePayload {
      items = items == null ? List.of() : List.copyOf(items);
    }
  }

  public record ComboRuleItemPayload(
      long productId,
      BigDecimal quantity
  ) {}

  public record SubsidyRulePayload(
      Long scopeProductId,
      String fundingSource,
      String fundingAccountCode
  ) {}

  public record MenuPayload(
      long menuId,
      String code,
      String name,
      String description,
      String status,
      String scopeType,
      Long scopeId,
      long version,
      Instant updatedAt,
      List<MenuCategoryPayload> categories
  ) {
    public MenuPayload {
      categories = categories == null ? List.of() : List.copyOf(categories);
    }
  }

  public record MenuCategoryPayload(
      long categoryId,
      String code,
      String name,
      int displayOrder,
      List<MenuItemPayload> items
  ) {
    public MenuCategoryPayload {
      items = items == null ? List.of() : List.copyOf(items);
    }
  }

  public record MenuItemPayload(
      long menuItemId,
      long productId,
      int displayOrder,
      boolean active
  ) {
  }

  public record SaleOrderPayload(
      long saleId,
      long storeId,
      Long posSessionId,
      String publicOrderToken,
      String currencyCode,
      String orderType,
      String status,
      String paymentStatus,
      BigDecimal subtotal,
      BigDecimal discount,
      BigDecimal taxAmount,
      BigDecimal totalAmount,
      String note,
      List<SaleOrderLinePayload> items,
      Instant createdAt
  ) {
    public SaleOrderPayload {
      items = items == null ? List.of() : List.copyOf(items);
    }
  }

  public record SaleOrderLinePayload(
      long productId,
      String productCode,
      String productName,
      BigDecimal quantity,
      BigDecimal unitPriceAtSaleTime,
      BigDecimal discountAmount,
      BigDecimal taxAmount,
      BigDecimal lineTotal,
      Set<Long> promotionIds,
      Long variantId,
      String variantName
  ) {
    public SaleOrderLinePayload {
      promotionIds = promotionIds == null ? Set.of() : Set.copyOf(promotionIds);
    }
  }

  public record PaymentTransactionPayload(
      long saleId,
      long storeId,
      String paymentMethod,
      BigDecimal amount,
      String currencyCode,
      String status,
      Instant paymentTime,
      String transactionRef,
      String note
  ) {
  }

  public record SaleOrderCancelledPayload(
      long saleId,
      long storeId,
      String reason,
      String status,
      String paymentStatus,
      Instant cancelledAt
  ) {
  }

  public record CashMovementPayload(
      long cashMovementId,
      long storeId,
      long sessionId,
      String type,
      BigDecimal amount,
      String reason,
      Long referenceSaleId,
      Long createdByUserId,
      Long approvedByUserId,
      Instant createdAt
  ) {
  }

  public record KitchenTicketPayload(
      long ticketId,
      long saleId,
      long storeId,
      Long orderingTableId,
      String orderingTableCode,
      String orderingTableName,
      String orderType,
      String status,
      int prepSlaSeconds,
      String notes,
      List<KitchenTicketItemPayload> items,
      Instant occurredAt
  ) {
    public KitchenTicketPayload {
      items = items == null ? List.of() : List.copyOf(items);
    }
  }

  public record KitchenTicketItemPayload(
      long itemId,
      long productId,
      String productName,
      BigDecimal qty,
      String status,
      String notes
  ) {
  }

  /** Region reference data; must be synced before STORE_CONFIG to satisfy FK core.outlet→core.region. */
  public record RegionPayload(
      long regionId,
      String code,
      String name,
      Long parentRegionId,
      String currencyCode,
      String timezoneName,
      String regionType,
      long version,
      Instant updatedAt
  ) {}

  /**
   * Tax rule payload scoped per outlet/category.
   * Allows store-edge to compute VAT offline without querying central.
   */
  public record TaxPolicyPayload(
      long taxRuleId,
      long outletId,
      String productCategoryCode,
      BigDecimal ratePct,
      boolean inclusive,
      LocalDate effectiveFrom,
      LocalDate effectiveTo,
      long version,
      Instant updatedAt
  ) {}

  /**
   * Stock movement payload from store-edge → central upload.
   * Central applies to offline_inventory_movement idempotently via source_event_id.
   */
  public record StockMovementPayload(
      String sourceEventId,
      String movementType,
      long outletId,
      long itemId,
      String sku,
      BigDecimal quantity,
      String unit,
      String reason,
      String note,
      Long posSessionId,
      Long deviceId,
      String terminalId,
      Long actorUserId,
      String actorUsername,
      LocalDate businessDate,
      Instant createdAtDevice
  ) {}
}
