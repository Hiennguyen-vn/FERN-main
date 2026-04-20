import { describe, expect, it } from 'vitest';
import {
  getCustomerOrderQueueFilter,
  isWaitingCustomerOrder,
} from '@/components/pos/customer-order-queue';

describe('customer order queue classifier', () => {
  it('treats a new unpaid public order as waiting', () => {
    const order = { status: 'order_created', paymentStatus: 'unpaid' };
    expect(isWaitingCustomerOrder(order)).toBe(true);
    expect(getCustomerOrderQueueFilter(order)).toBe('waiting');
  });

  it('treats approved orders as approved and not waiting', () => {
    const order = { backendStatus: 'order_approved', paymentStatus: 'unpaid' };
    expect(isWaitingCustomerOrder(order)).toBe(false);
    expect(getCustomerOrderQueueFilter(order)).toBe('approved');
  });

  it('treats paid or completed orders as paid and not waiting', () => {
    expect(isWaitingCustomerOrder({ status: 'payment_done', paymentStatus: 'paid' })).toBe(false);
    expect(getCustomerOrderQueueFilter({ status: 'payment_done', paymentStatus: 'paid' })).toBe('paid');
    expect(getCustomerOrderQueueFilter({ status: 'completed', paymentStatus: 'unpaid' })).toBe('paid');
  });

  it('treats cancelled orders as cancelled and not waiting', () => {
    const order = { status: 'cancelled', paymentStatus: 'unpaid' };
    expect(isWaitingCustomerOrder(order)).toBe(false);
    expect(getCustomerOrderQueueFilter(order)).toBe('cancelled');
  });
});
