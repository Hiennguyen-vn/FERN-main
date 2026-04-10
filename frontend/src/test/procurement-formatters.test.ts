import { describe, expect, it } from 'vitest';
import {
  formatProcurementAmount,
  formatProcurementStatusLabel,
  procurementStatusTone,
} from '@/components/procurement/formatters';

describe('procurement formatters', () => {
  it('formats USD amounts with grouping and two decimals', () => {
    expect(formatProcurementAmount(50001000, 'USD')).toBe('50,001,000.00');
  });

  it('formats VND amounts without fractional digits', () => {
    expect(formatProcurementAmount(2209420, 'VND')).toBe('2,209,420');
  });

  it('formats procurement statuses into readable labels', () => {
    expect(formatProcurementStatusLabel('partially_received')).toBe('Partially Received');
    expect(formatProcurementStatusLabel('pending_review')).toBe('Pending Review');
  });

  it('maps ordered status to a non-muted badge tone', () => {
    expect(procurementStatusTone('ordered')).toContain('text-blue-700');
  });

  it('maps matched invoice status to an active badge tone', () => {
    expect(procurementStatusTone('matched')).toContain('text-blue-700');
  });
});
