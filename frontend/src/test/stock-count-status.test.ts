import { describe, expect, it } from 'vitest';
import {
  canPostStockCountSession,
  formatStockCountStatus,
  stockCountStatusBadgeClass,
} from '@/components/inventory/stock-count-status';

describe('stock count status helpers', () => {
  it('formats stock count statuses for badges and filters', () => {
    expect(formatStockCountStatus('approved')).toBe('Approved');
    expect(formatStockCountStatus('pending_review')).toBe('Pending Review');
  });

  it('maps approved sessions to an active badge tone', () => {
    expect(stockCountStatusBadgeClass('approved')).toContain('text-blue-700');
  });

  it('blocks posting only for final stock count statuses', () => {
    expect(canPostStockCountSession('draft')).toBe(true);
    expect(canPostStockCountSession('approved')).toBe(true);
    expect(canPostStockCountSession('posted')).toBe(false);
    expect(canPostStockCountSession('cancelled')).toBe(false);
  });
});
