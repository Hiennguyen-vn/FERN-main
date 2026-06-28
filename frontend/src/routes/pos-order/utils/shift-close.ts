import { BACKEND_PAYMENT_METHODS, normalizePaymentMethod, paymentMethodLabel } from './payment-methods';
import type { PaymentBreakdownRow } from '../hooks/use-shift-close-summary';
import type { PosSessionPaymentSummaryView } from '@/api/sales-api';

export interface CashSessionSummary {
  openFloat: number;
  salesCash: number;
  paidIn: number;
  paidOut: number;
  drops: number;
  expectedTotal: number;
  counted: number;
  variance: number;
}

export function decodeCashSessionSummary(raw: unknown): CashSessionSummary {
  const record = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const num = (key: string) => {
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    openFloat: num('openFloat'),
    salesCash: num('salesCash'),
    paidIn: num('paidIn'),
    paidOut: num('paidOut'),
    drops: num('drops'),
    expectedTotal: num('expectedTotal'),
    counted: num('counted'),
    variance: num('variance'),
  };
}

/** Expected cash in drawer: prefer backend cash ledger, fallback to client estimate. */
export function resolveExpectedCashInDrawer(
  cashSummary: CashSessionSummary | null | undefined,
  openingCashFallback: number,
  cashSalesTotal: number,
): number {
  if (cashSummary && cashSummary.expectedTotal > 0) {
    return cashSummary.expectedTotal;
  }
  return openingCashFallback + cashSalesTotal;
}

export function resolveOpeningFloat(
  cashSummary: CashSessionSummary | null | undefined,
  sessionStorageFallback: number,
): number {
  if (cashSummary && cashSummary.openFloat > 0) {
    return cashSummary.openFloat;
  }
  return sessionStorageFallback;
}

export function decodePaymentSummary(raw: PosSessionPaymentSummaryView): {
  orderCount: number;
  totalRevenue: number;
  paymentBreakdown: PaymentBreakdownRow[];
} {
  const paymentBreakdown = raw.items
    .map((item) => {
      const method = normalizePaymentMethod(item.paymentMethod);
      return {
        method,
        label: paymentMethodLabel(method),
        total: item.total,
        count: item.count,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    orderCount: raw.orderCount,
    totalRevenue: raw.totalRevenue,
    paymentBreakdown,
  };
}

export function buildReconcileLines(
  paymentBreakdown: PaymentBreakdownRow[],
  cashCounted: number,
): Array<{ paymentMethod: string; actualAmount: number }> {
  const expectedByMethod = new Map(paymentBreakdown.map((row) => [row.method, row.total]));
  return BACKEND_PAYMENT_METHODS.map((method) => ({
    paymentMethod: method,
    actualAmount: method === 'cash' ? cashCounted : (expectedByMethod.get(method) ?? 0),
  }));
}

export function parseUnpaidOrdersError(message: string): number | null {
  const match = message.match(/SESSION_HAS_UNPAID_ORDERS:(\d+)/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}
