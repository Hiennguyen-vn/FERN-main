import { describe, expect, it } from 'vitest';
import type { CartLine } from '@/routes/pos-order/hooks/use-pos-cart';
import { buildLineSubtitle, lineUnitPrice } from '@/routes/pos-order/utils/line-modifiers';

describe('line modifiers', () => {
  const baseLine: CartLine = {
    lineId: 'line-1',
    itemId: 'product-1',
    name: 'Pho Ga',
    basePrice: 45000,
    toppings: [],
    quantity: 1,
  };

  it('prices structured modifier groups once', () => {
    const line: CartLine = {
      ...baseLine,
      modifiers: [
        { groupCode: 'size', groupName: 'Size', optionCode: 'M', optionLabel: 'Medium', priceDelta: 5000 },
      ],
      modifierOptionIds: ['3485603532641943593'],
    };

    expect(lineUnitPrice(line)).toBe(50000);
    expect(buildLineSubtitle(line)).toBe('Size: Medium (+5.000)');
  });

  it('keeps legacy size and toppings pricing as fallback', () => {
    const line: CartLine = {
      ...baseLine,
      sizePriceAdd: 5000,
      toppings: [{ code: 'toppings:EGG', name: 'Add egg', priceAdd: 5000 }],
    };

    expect(lineUnitPrice(line)).toBe(55000);
    expect(buildLineSubtitle(line)).toBe('+Add egg');
  });
});
