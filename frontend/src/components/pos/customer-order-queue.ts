export type CustomerOrderQueueStatusLike = {
  status?: string | null;
  backendStatus?: string | null;
  paymentStatus?: string | null;
};

export type CustomerOrderQueueFilter = 'all' | 'waiting' | 'approved' | 'paid' | 'cancelled';

function normalizeStatus(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

export function isWaitingCustomerOrder(order: CustomerOrderQueueStatusLike) {
  return getCustomerOrderQueueFilter(order) === 'waiting';
}

export function getCustomerOrderQueueFilter(order: CustomerOrderQueueStatusLike): CustomerOrderQueueFilter {
  const status = normalizeStatus(order.backendStatus ?? order.status);
  const paymentStatus = normalizeStatus(order.paymentStatus);
  if (status === 'cancelled' || status === 'rejected') return 'cancelled';
  if (paymentStatus === 'paid' || status === 'completed' || status === 'payment_done') return 'paid';
  if (status === 'order_approved') return 'approved';
  return 'waiting';
}

export function canCaptureCustomerOrderPayment(order: CustomerOrderQueueStatusLike) {
  const status = normalizeStatus(order.backendStatus ?? order.status);
  const paymentStatus = normalizeStatus(order.paymentStatus);
  return status === 'order_approved' && paymentStatus !== 'paid';
}
