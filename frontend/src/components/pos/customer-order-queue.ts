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
  const status = normalizeStatus(order.backendStatus ?? order.status);
  const paymentStatus = normalizeStatus(order.paymentStatus);
  return status !== 'cancelled'
      && status !== 'completed'
      && paymentStatus !== 'paid'
      && status !== 'order_approved';
}

export function getCustomerOrderQueueFilter(order: CustomerOrderQueueStatusLike): CustomerOrderQueueFilter {
  const status = normalizeStatus(order.backendStatus ?? order.status);
  const paymentStatus = normalizeStatus(order.paymentStatus);
  if (status === 'cancelled') return 'cancelled';
  if (paymentStatus === 'paid' || status === 'completed') return 'paid';
  if (status === 'order_approved') return 'approved';
  return 'waiting';
}
