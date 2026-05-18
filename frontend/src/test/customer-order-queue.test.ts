import { describe, expect, it } from 'vitest';
import {
  canCaptureCustomerOrderPayment,
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
    expect(canCaptureCustomerOrderPayment(order)).toBe(true);
  });

  it('treats paid or completed orders as paid and not waiting', () => {
    expect(isWaitingCustomerOrder({ status: 'payment_done', paymentStatus: 'paid' })).toBe(false);
    expect(getCustomerOrderQueueFilter({ status: 'payment_done', paymentStatus: 'paid' })).toBe('paid');
    expect(getCustomerOrderQueueFilter({ status: 'payment_done', paymentStatus: 'unpaid' })).toBe('paid');
    expect(getCustomerOrderQueueFilter({ status: 'completed', paymentStatus: 'unpaid' })).toBe('paid');
    expect(canCaptureCustomerOrderPayment({ status: 'payment_done', paymentStatus: 'paid' })).toBe(false);
  });

  it('treats cancelled orders as cancelled and not waiting', () => {
    const order = { status: 'cancelled', paymentStatus: 'unpaid' };
    expect(isWaitingCustomerOrder(order)).toBe(false);
    expect(getCustomerOrderQueueFilter(order)).toBe('cancelled');
    expect(canCaptureCustomerOrderPayment(order)).toBe(false);
  });

  it('does not allow payment capture for unapproved customer orders', () => {
    expect(canCaptureCustomerOrderPayment({ status: 'order_created', paymentStatus: 'unpaid' })).toBe(false);
    expect(canCaptureCustomerOrderPayment({ status: 'approved', paymentStatus: 'unpaid' })).toBe(false);
  });
});
