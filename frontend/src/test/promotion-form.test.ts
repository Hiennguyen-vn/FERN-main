import { describe, expect, it } from 'vitest';
import { buildCreatePromotionPayload, createDefaultPromotionFormValues } from '@/components/promotions/promotion-form';

describe('promotion-form', () => {
  it('preserves bigint-safe outlet ids when building a create promotion payload', () => {
    const payload = buildCreatePromotionPayload(
      {
        ...createDefaultPromotionFormValues(new Date('2026-04-22T03:38:00Z')),
        name: 'Lunch 1',
        valuePercent: '30',
        minOrderAmount: '1',
        effectiveTo: '2026-05-31T10:39',
      },
      ['3481632263605075968', '3481632284538847232'],
    );

    expect(payload).toMatchObject({
      name: 'Lunch 1',
      promoType: 'percentage',
      valuePercent: 30,
      minOrderAmount: 1,
      maxDiscountAmount: null,
      outletIds: ['3481632263605075968', '3481632284538847232'],
    });
    expect(payload.effectiveFrom).toBe(new Date('2026-04-22T03:38').toISOString());
    expect(payload.effectiveTo).toBe(new Date('2026-05-31T10:39').toISOString());
  });
});
