import { describe, expect, it } from 'vitest';
import { calculatePromotionDiscount } from '@/components/pos/promotion-utils';

describe('calculatePromotionDiscount', () => {
  it('calculates a percentage discount from the subtotal', () => {
    expect(calculatePromotionDiscount(100000, {
      id: 'promo-1',
      promoType: 'percentage',
      valuePercent: 40,
    })).toBe(40000);
  });

  it('caps the discount by max discount amount', () => {
    expect(calculatePromotionDiscount(100000, {
      id: 'promo-1',
      promoType: 'percentage',
      valuePercent: 40,
      maxDiscountAmount: 15000,
    })).toBe(15000);
  });

  it('returns zero when the subtotal does not meet the minimum order amount', () => {
    expect(calculatePromotionDiscount(90000, {
      id: 'promo-1',
      promoType: 'percentage',
      valuePercent: 40,
      minOrderAmount: 100000,
    })).toBe(0);
  });

  it('calculates fixed-amount promotions and never exceeds subtotal', () => {
    expect(calculatePromotionDiscount(100000, {
      id: 'promo-1',
      promoType: 'fixed_amount',
      valueAmount: 120000,
    })).toBe(100000);
  });
});
