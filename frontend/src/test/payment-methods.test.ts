import { describe, expect, it } from 'vitest';
import { normalizePaymentMethod, resolveSalePaymentMethod } from '@/routes/pos-order/utils/payment-methods';

describe('payment method helpers', () => {
  it('normalizes QR aliases to ewallet', () => {
    expect(normalizePaymentMethod('qr_code')).toBe('ewallet');
    expect(normalizePaymentMethod('qr')).toBe('ewallet');
  });

  it('resolves card from list item paymentMethod field', () => {
    expect(resolveSalePaymentMethod({ paymentMethod: 'card' })).toBe('card');
  });

  it('prefers nested payment object over top-level field', () => {
    expect(resolveSalePaymentMethod({
      paymentMethod: 'cash',
      payment: { paymentMethod: 'card' },
    })).toBe('card');
  });

  it('does not default to cash when paymentMethod is present on list items', () => {
    expect(resolveSalePaymentMethod({
      paymentMethod: 'card',
      payment: null,
    })).toBe('card');
  });
});
