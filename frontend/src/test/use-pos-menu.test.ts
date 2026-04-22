import { describe, expect, it } from 'vitest';
import { mergeMenu } from '@/routes/pos-order/hooks/use-pos-menu';
import type { ModifierGroupView, ProductView, RecipeView } from '@/api/product-api';
import type { StockBalanceView } from '@/api/inventory-api';

describe('mergeMenu', () => {
  const groups: ModifierGroupView[] = [];

  it('keeps products visible but marks them unavailable when ingredients are short', () => {
    const products: ProductView[] = [
      { id: '101', name: 'Pho Bo Tai', categoryCode: 'pho', status: 'active' },
    ];
    const prices = [{ productId: '101', priceValue: 45000 }];
    const recipesByProduct = new Map<string, RecipeView | null | undefined>([
      ['101', {
        productId: '101',
        status: 'active',
        yieldQty: 1,
        items: [{ itemId: '501', qtyRequired: 0.2, uomCode: 'kg' }],
      }],
    ]);
    const stockByItem = new Map<string, StockBalanceView>([
      ['501', { itemId: '501', qtyOnHand: 0.05, unitCode: 'kg' }],
    ]);

    const result = mergeMenu(
      products,
      prices,
      groups,
      new Map(),
      recipesByProduct,
      stockByItem,
    );

    expect(result.menu).toHaveLength(1);
    expect(result.menu[0]).toMatchObject({
      id: '101',
      isAvailable: false,
      unavailableCode: 'insufficient_ingredients',
      unavailableReason: 'Không đủ nguyên liệu để làm',
    });
    expect(result.categories).toEqual([{ code: 'pho', name: 'Pho', count: 1 }]);
    expect(result.unavailableCount).toBe(1);
    expect(result.insufficientIngredientCount).toBe(1);
  });

  it('hides products without outlet pricing from the POS grid', () => {
    const products: ProductView[] = [
      { id: '102', name: 'Mi Quang', categoryCode: 'bun', status: 'active' },
    ];

    const result = mergeMenu(
      products,
      [],
      groups,
      new Map(),
      new Map(),
      null,
    );

    expect(result.menu).toHaveLength(0);
    expect(result.categories).toEqual([]);
    expect(result.missingPriceCount).toBe(1);
    expect(result.unavailableCount).toBe(0);
  });

  it('does not block products when no active recipe is available to evaluate stock', () => {
    const products: ProductView[] = [
      { id: '103', name: 'Ca Phe Sua', categoryCode: 'bean', status: 'active' },
    ];
    const prices = [{ productId: '103', priceValue: 30000 }];

    const result = mergeMenu(
      products,
      prices,
      groups,
      new Map(),
      new Map([['103', null]]),
      new Map(),
    );

    expect(result.menu[0]).toMatchObject({
      id: '103',
      isAvailable: true,
      unavailableCode: undefined,
      unavailableReason: undefined,
    });
  });
});
