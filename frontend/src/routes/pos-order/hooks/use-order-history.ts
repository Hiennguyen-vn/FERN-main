import { useCallback, useEffect, useState } from 'react';
import type { CartLine, OrderType } from './use-pos-cart';

export interface SavedOrder {
  orderNo: string;
  createdAt: string;
  orderType: OrderType;
  customerName?: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paymentMethod: string;
}

const todayKey = () => {
  const d = new Date();
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `pos-order-history-${s}`;
};

export function useOrderHistory() {
  const [orders, setOrders] = useState<SavedOrder[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(todayKey());
      if (raw) setOrders(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const save = useCallback((o: SavedOrder) => {
    setOrders((prev) => {
      const next = [o, ...prev].slice(0, 50);
      try { localStorage.setItem(todayKey(), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const nextOrderNo = useCallback(() => {
    const n = orders.length + 1;
    return String(n).padStart(4, '0');
  }, [orders]);

  return { orders, save, nextOrderNo };
}
