import type { RecipeView } from '@/api/product-api';
import { productApi } from '@/api/product-api';

/** Fetch product recipes in bounded parallel batches. */
export async function fetchRecipeMap(
  token: string,
  productIds: string[],
  batchSize = 8,
): Promise<Map<string, RecipeView | null>> {
  const map = new Map<string, RecipeView | null>();
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const chunk = uniqueIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map(async (productId) => {
        const recipe = await productApi.recipe(token, productId).catch(() => null);
        return { productId, recipe };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map.set(result.value.productId, result.value.recipe);
      }
    }
  }
  return map;
}
