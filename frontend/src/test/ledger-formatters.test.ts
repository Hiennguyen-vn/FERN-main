import { describe, expect, it } from 'vitest';
import {
  formatLedgerTxnType,
  ledgerTxnTypeBadgeClass,
} from '@/components/inventory/ledger-formatters';

describe('ledger formatter helpers', () => {
  it('maps backend inventory transaction enums to humanized backend-aligned labels', () => {
    expect(formatLedgerTxnType('purchase_in')).toBe('Purchase in');
    expect(formatLedgerTxnType('stock_adjustment_in')).toBe('Stock adjustment in');
    expect(formatLedgerTxnType('stock_adjustment_out')).toBe('Stock adjustment out');
    expect(formatLedgerTxnType('sale_usage')).toBe('Sale usage');
    expect(formatLedgerTxnType('manufacture_in')).toBe('Manufacture in');
  });

  it('keeps stock adjustment aliases and concrete types on the same badge tone', () => {
    expect(ledgerTxnTypeBadgeClass('stock_adjustment_in')).toContain('text-blue-700');
    expect(ledgerTxnTypeBadgeClass('stock_adjustment')).toContain('text-blue-700');
    expect(ledgerTxnTypeBadgeClass('stock_count')).toContain('text-blue-700');
  });
});
