import { describe, expect, it } from 'vitest';
import {
  resolveGoodsReceiptCurrency,
  resolveProcurementScopeCurrency,
} from '@/components/procurement/procurement-currency';

describe('procurement currency resolution', () => {
  it('uses outlet region currency for outlet-scoped procurement forms', () => {
    expect(resolveProcurementScopeCurrency({
      regions: [
        {
          id: '10',
          code: 'VN',
          name: 'Vietnam',
          currencyCode: 'VND',
        },
      ],
      outlets: [
        {
          id: '2000',
          regionId: '10',
          code: 'SIM-MEDIUM-OUT-0001',
          name: 'Outlet VN-HCM-1',
          status: 'active',
        },
      ],
      outletId: '2000',
      regionId: '10',
    })).toBe('VND');
  });

  it('falls back to region currency for region-scoped procurement forms', () => {
    expect(resolveProcurementScopeCurrency({
      regions: [
        {
          id: '20',
          code: 'US',
          name: 'United States',
          currencyCode: 'USD',
        },
      ],
      outlets: [],
      regionId: '20',
    })).toBe('USD');
  });

  it('keeps goods receipt currency locked to the selected purchase order currency', () => {
    expect(resolveGoodsReceiptCurrency({
      purchaseOrderCurrencyCode: 'eur',
      scopeCurrencyCode: 'VND',
    })).toBe('EUR');
  });

  it('falls back to scope currency when no purchase order is selected', () => {
    expect(resolveGoodsReceiptCurrency({
      scopeCurrencyCode: 'vnd',
    })).toBe('VND');
  });
});
