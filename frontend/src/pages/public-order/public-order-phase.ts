import type { PublicOrderReceiptView } from '@/api/fern-api';

export type PublicOrderPhase = 'pending' | 'approved' | 'paid' | 'cancelled';

export function derivePublicOrderPhase(receipt: PublicOrderReceiptView | null | undefined): PublicOrderPhase {
  if (!receipt) return 'pending';
  const status = String(receipt.orderStatus || '').toLowerCase();
  const payment = String(receipt.paymentStatus || '').toLowerCase();
  if (status.includes('cancel') || status.includes('reject') || status.includes('void')) return 'cancelled';
  if (payment === 'paid' || status.includes('payment_done')) return 'paid';
  if (status.includes('approved') || status.includes('confirmed') || status.includes('completed')) return 'approved';
  if (status === 'pending' || status.includes('created')) return 'pending';
  return 'pending';
}
