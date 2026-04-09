package com.fern.simulator.model;

import java.util.List;

/**
 * Tracks a simulated product with its recipe, pricing, and COGS.
 */
public record SimProduct(
        long id,
        String code,
        String name,
        String categoryCode,
        long categoryId,
        List<RecipeItem> recipeItems,
        long priceAmount,
        long costAmount, // COGS per unit (sum of ingredient costs)
        String currencyCode
) {
    /**
     * A single ingredient in a product recipe.
     */
    public record RecipeItem(
            long recipeId,
            long recipeItemId,
            long itemId,
            int quantity,
            String uomCode
    ) {}
}
