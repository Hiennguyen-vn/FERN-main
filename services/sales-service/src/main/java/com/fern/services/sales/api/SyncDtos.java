package com.fern.services.sales.api;

import java.util.List;

public class SyncDtos {

  // ── Push (Edge → Cloud) ──────────────────────────────────────────────────

  public record PushRequest(
      String deviceId,
      List<PushEvent> events
  ) {}

  public record PushEvent(
      String eventId,
      String idempotencyKey,
      String type,
      String clientOccurredAt,
      String estimatedTime,
      long monotonicSeq,
      Object payload
  ) {}

  public record PushResponse(
      List<String> accepted,
      List<RejectedEvent> rejected
  ) {}

  public record RejectedEvent(
      String eventId,
      String reason
  ) {}

  // ── Pull / Catalog (Cloud → Edge) ────────────────────────────────────────

  public record CatalogRow(
      long id,
      long outletId,
      String name,
      long categoryId,
      String categoryName,
      boolean isAvailable,
      long priceCents,
      long taxBasisPoints,
      long updatedAt   // epoch millis
  ) {}

  // ── Pull / Stock (Cloud → Edge) ──────────────────────────────────────────

  public record StockRow(
      long itemId,
      long outletId,
      String qtyOnHand,
      long lastMovementAt  // epoch millis
  ) {}

  // ── Pull / Recipes (Cloud → Edge) ────────────────────────────────────────

  public record RecipeComponentRow(
      long itemId,
      String itemCode,
      String itemName,
      String componentQty,
      String yieldQty,
      String componentUomCode,
      String itemBaseUomCode,
      String conversionFactor
  ) {}

  public record RecipeRow(
      long productId,
      String version,
      String yieldQty,
      String yieldUomCode,
      String status,
      long updatedAt,
      List<RecipeComponentRow> components,
      List<ModifierEffectRow> modifierEffects
  ) {
    /** Backward-compat ctor: omit modifierEffects (old callers / tests). */
    public RecipeRow(long productId, String version, String yieldQty, String yieldUomCode,
                     String status, long updatedAt, List<RecipeComponentRow> components) {
      this(productId, version, yieldQty, yieldUomCode, status, updatedAt, components, List.of());
    }
  }

  public record ModifierEffectRow(
      long modifierOptionId,
      String effectType,
      Long ingredientId,
      Long substituteIngredientId,
      String multiplier,
      String qtyDelta
  ) {}

  // ── Pull / Menu snapshot (Cloud → Edge hub) ───────────────────────────────

  public record MenuProductRow(
      long id,
      long outletId,
      String code,
      String name,
      long categoryId,
      String categoryName,
      boolean isActive,
      boolean isAvailable,
      long priceCents,
      long taxBasisPoints
  ) {}

  public record MenuVariantRow(
      long id,
      long productId,
      String code,
      String name,
      String priceModifierType,
      String priceModifierValue,
      int displayOrder,
      boolean isActive
  ) {}

  public record MenuModifierGroupRow(
      long id,
      String code,
      String name,
      String selectionType,
      int minSelections,
      int maxSelections,
      int displayOrder,
      boolean isActive
  ) {}

  public record MenuModifierOptionRow(
      long id,
      long modifierGroupId,
      String code,
      String name,
      String priceAdjustment,
      int displayOrder,
      boolean isActive
  ) {}

  public record MenuProductModifierGroupRow(
      long productId,
      long modifierGroupId,
      boolean isRequired,
      int displayOrder
  ) {}

  public record MenuSnapshot(
      long outletId,
      long version,
      List<MenuProductRow> products,
      List<MenuVariantRow> variants,
      List<MenuModifierGroupRow> modifierGroups,
      List<MenuModifierOptionRow> modifierOptions,
      List<MenuProductModifierGroupRow> productModifierGroups
  ) {}

  // ── Manifest ─────────────────────────────────────────────────────────────

  public record ManifestResponse(
      long catalogVersion,
      long priceVersion,
      long stockVersion,
      long recipeVersion,
      long menuVersion,
      String serverTime,
      String signature,
      String keyId
  ) {
    public ManifestResponse(long c, long p, long s, long r, long m, String t) {
      this(c, p, s, r, m, t, null, null);
    }
  }

  public record TaxRuleRow(
      long id,
      long outletId,
      String productCategoryCode,  // null = applies to all categories
      java.math.BigDecimal ratePct,
      boolean inclusive,
      java.time.LocalDate effectiveFrom,
      java.time.LocalDate effectiveTo    // null = open-ended
  ) {}
}
