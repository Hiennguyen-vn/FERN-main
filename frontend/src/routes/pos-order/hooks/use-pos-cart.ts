import { useCallback, useMemo, useState } from 'react';
import { VOUCHERS } from '../data/mock-menu';
import { lineUnitPrice } from '../utils/line-modifiers';

export interface CartLineModifier {
  groupCode: string;
  groupName: string;
  optionCode: string;
  optionLabel: string;
  priceDelta: number;
}

export interface CartLine {
  lineId: string;
  itemId: string;
  name: string;
  basePrice: number;
  size?: string;
  sizePriceAdd?: number;
  sugar?: string;
  ice?: string;
  toppings: { code: string; name: string; priceAdd: number }[];
  modifiers?: CartLineModifier[];
  modifierOptionIds?: string[];
  note?: string;
  quantity: number;
}

export interface AppliedVoucher {
  code: string;
  label: string;
  discount: number;
  promotionId?: string;
}

export type OrderType = 'takeaway' | 'dinein';

const VAT_RATE = 0.08;

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [customerName, setCustomerName] = useState('');
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [voucher, setVoucher] = useState<AppliedVoucher | null>(null);
  const [voucherError, setVoucherError] = useState('');

  const lineTotal = (l: CartLine) => {
    return lineUnitPrice(l) * l.quantity;
  };

  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);

  const discount = useMemo(() => {
    if (!voucher) return 0;
    if (voucher.code === 'HAPPY50K' && subtotal < 200000) return 0;
    return Math.min(voucher.discount, subtotal);
  }, [voucher, subtotal]);

  const vat = useMemo(() => Math.round((subtotal - discount) * VAT_RATE), [subtotal, discount]);
  const total = subtotal - discount + vat;

  const addLine = useCallback((line: Omit<CartLine, 'lineId'>) => {
    setLines((prev) => [...prev, { ...line, lineId: crypto.randomUUID() }]);
  }, []);

  const updateQty = useCallback((lineId: string, qty: number) => {
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(1, qty) } : l)));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const setVoucherApplied = useCallback((next: AppliedVoucher | null, error = '') => {
    setVoucher(next);
    setVoucherError(error);
  }, []);

  const applyVoucher = useCallback((code: string) => {
    const up = code.trim().toUpperCase();
    if (!up) {
      setVoucher(null);
      setVoucherError('');
      return;
    }
    const v = VOUCHERS[up];
    if (!v) {
      setVoucher(null);
      setVoucherError('Mã không hợp lệ');
      return;
    }
    if (up === 'HAPPY50K' && subtotal < 200000) {
      setVoucher(null);
      setVoucherError('Đơn tối thiểu 200.000đ');
      return;
    }
    const discountAmt = v.type === 'percent' ? Math.round((subtotal * v.value) / 100) : v.value;
    setVoucher({ code: up, label: v.label, discount: discountAmt });
    setVoucherError('');
  }, [subtotal]);

  const restore = useCallback((snapshot: {
    lines: CartLine[];
    orderType: OrderType;
    customerName?: string;
  }) => {
    setLines(snapshot.lines);
    setOrderType(snapshot.orderType);
    setCustomerName(snapshot.customerName ?? '');
    setVoucher(null);
    setVoucherError('');
    setLoyaltyPhone('');
  }, []);

  const reset = useCallback(() => {
    setLines([]);
    setCustomerName('');
    setLoyaltyPhone('');
    setVoucher(null);
    setVoucherError('');
    setOrderType('takeaway');
  }, []);

  return {
    lines,
    lineTotal,
    orderType,
    setOrderType,
    customerName,
    setCustomerName,
    loyaltyPhone,
    setLoyaltyPhone,
    voucher,
    voucherError,
    applyVoucher,
    setVoucherApplied,
    addLine,
    updateQty,
    removeLine,
    restore,
    reset,
    subtotal,
    discount,
    vat,
    total,
  };
}
