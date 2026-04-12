import { describe, expect, it } from 'vitest';
import {
  computePublicOrderCartSummary,
  formatPublicLabel,
  groupPublicMenuByCategory,
  sanitizePublicOrderCartDraft,
  toCreatePublicOrderPayload,
} from '@/lib/public-order';

describe('public-order model helpers', () => {
  it('groups backend menu items by category code', () => {
    const categories = groupPublicMenuByCategory([
      { productId: '5000', name: 'Cafe Latte', categoryCode: 'beverage' },
      { productId: '5001', name: 'Espresso', categoryCode: 'beverage' },
      { productId: '5002', name: 'Croissant', categoryCode: 'bakery' },
    ]);

    expect(categories).toEqual([
      {
        code: 'beverage',
        label: 'Beverage',
        items: [
          { productId: '5000', name: 'Cafe Latte', categoryCode: 'beverage' },
          { productId: '5001', name: 'Espresso', categoryCode: 'beverage' },
        ],
      },
      {
        code: 'bakery',
        label: 'Bakery',
        items: [{ productId: '5002', name: 'Croissant', categoryCode: 'bakery' }],
      },
    ]);
  });

  it('sanitizes cart drafts loaded from storage', () => {
    const draft = sanitizePublicOrderCartDraft({
      note: '  window seat please  ',
      items: [
        { productId: '5000', quantity: 2, note: ' less ice ' },
        { productId: '', quantity: 1, note: 'skip' },
        { productId: '5001', quantity: 0, note: '' },
      ],
    });

    expect(draft).toEqual({
      note: 'window seat please',
      items: [{ productId: '5000', quantity: 2, note: 'less ice' }],
    });
  });

  it('computes subtotal and flags invalid cart lines against the live menu', () => {
    const summary = computePublicOrderCartSummary(
      {
        note: '',
        items: [
          { productId: '5000', quantity: 2, note: '' },
          { productId: '9999', quantity: 1, note: '' },
        ],
      },
      new Map([
        ['5000', { productId: '5000', priceValue: 65000 }],
      ]),
    );

    expect(summary).toEqual({
      itemCount: 3,
      subtotal: 130000,
      invalidProductIds: ['9999'],
    });
  });

  it('builds backend payloads with null notes only when empty', () => {
    expect(toCreatePublicOrderPayload({
      note: '  no sugar  ',
      items: [
        { productId: '5000', quantity: 2, note: ' less ice ' },
        { productId: '5001', quantity: 1, note: '' },
      ],
    })).toEqual({
      note: 'no sugar',
      items: [
        { productId: '5000', quantity: 2, note: 'less ice' },
        { productId: '5001', quantity: 1, note: null },
      ],
    });
  });

  it('formats enum-like codes into readable labels', () => {
    expect(formatPublicLabel('payment_pending')).toBe('Payment Pending');
    expect(formatPublicLabel('')).toBe('Unknown');
  });
});
