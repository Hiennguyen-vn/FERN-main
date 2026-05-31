import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from '@/routes/pos-order/components/PaymentDialog';

describe('PaymentDialog', () => {
  it('waits for the paid state before showing print actions', () => {
    const onConfirm = vi.fn();
    const onPrintOrder = vi.fn();
    const onNewOrder = vi.fn();
    const { rerender } = render(
      <PaymentDialog
        open
        onOpenChange={() => {}}
        total={48600}
        orderNo="0010"
        onConfirm={onConfirm}
        onPrintOrder={onPrintOrder}
        onNewOrder={onNewOrder}
        isPaid={false}
      />,
    );

    const cashInput = document.querySelector('input[type="number"]');
    expect(cashInput).not.toBeNull();
    fireEvent.change(cashInput!, { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thanh toán' }));

    expect(onConfirm).toHaveBeenCalledWith('cash');
    expect(screen.queryByText('Thanh toán thành công!')).toBeNull();

    rerender(
      <PaymentDialog
        open
        onOpenChange={() => {}}
        total={48600}
        orderNo="0010"
        onConfirm={onConfirm}
        onPrintOrder={onPrintOrder}
        onNewOrder={onNewOrder}
        isPaid
      />,
    );

    expect(screen.getByText('Thanh toán thành công!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /In hóa đơn \+ KOT/i }));
    expect(onPrintOrder).toHaveBeenCalledTimes(1);
  });
});
