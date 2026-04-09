import type { PaymentMethod } from '@/types/pos';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  'e-wallet': 'E-Wallet',
  'bank-transfer': 'Bank Transfer',
  voucher: 'Voucher',
};

export function normalizeNumericId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}
