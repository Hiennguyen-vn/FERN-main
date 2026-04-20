import { useCallback, useRef, useState } from 'react';
import { salesApi, type CreateSalePayload, type SaleDetailView } from '@/api/sales-api';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/use-auth';
import type { CartLine, OrderType } from './use-pos-cart';

export type SubmitPhase =
  | 'idle'
  | 'creating'
  | 'created'
  | 'approving'
  | 'approved'
  | 'paying'
  | 'paid'
  | 'create_failed'
  | 'approve_failed'
  | 'payment_failed';

export type UiPayMethod = 'cash' | 'card' | 'qr' | 'voucher';

const UI_TO_BACKEND_METHOD: Record<UiPayMethod, string> = {
  cash: 'cash',
  card: 'card',
  qr: 'ewallet',
  voucher: 'voucher',
};

const UI_TO_BACKEND_ORDER_TYPE: Record<OrderType, string> = {
  takeaway: 'takeaway',
  dinein: 'dine_in',
};

const ALLOWED_ORDER_TYPE_VALUES = new Set(Object.values(UI_TO_BACKEND_ORDER_TYPE));
const ALLOWED_METHOD_VALUES = new Set(Object.values(UI_TO_BACKEND_METHOD));

const PENDING_PREFIX = 'pos-order-pending-';

export interface SubmitError {
  message: string;
  status?: number;
  errorCode?: string;
  details?: unknown;
}

export interface PendingSnapshot {
  idempotencyKey: string;
  phase: SubmitPhase;
  saleId?: string;
  outletId: string;
  currencyCode: string;
  createdAt: string;
  lines: CartLine[];
  previewTotal: number;
  backendTotal?: number | null;
  method: UiPayMethod;
  orderType: OrderType;
  error?: string;
}

export interface SubmitArgs {
  outletId: string;
  currencyCode: string;
  posSessionId: string | null;
  orderType: OrderType;
  customerName?: string;
  lines: CartLine[];
  lineUnitPrice: (l: CartLine) => number;
  subtotal: number;
  discount: number;
  vat: number;
  previewTotal: number;
  method: UiPayMethod;
}

function saveSnapshot(snap: PendingSnapshot) {
  try { localStorage.setItem(PENDING_PREFIX + snap.idempotencyKey, JSON.stringify(snap)); } catch { /* ignore */ }
}
function removeSnapshot(key: string) {
  try { localStorage.removeItem(PENDING_PREFIX + key); } catch { /* ignore */ }
}

export function listPendingOrders(): PendingSnapshot[] {
  const out: PendingSnapshot[] = [];
  if (typeof window === 'undefined') return out;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PENDING_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      out.push(JSON.parse(raw) as PendingSnapshot);
    } catch { /* ignore */ }
  }
  return out;
}

function toSubmitError(ex: unknown, fallbackMessage: string): SubmitError {
  if (ex instanceof ApiError) {
    const details = ex.details && typeof ex.details === 'object' ? (ex.details as Record<string, unknown>) : undefined;
    return {
      message: ex.message || fallbackMessage,
      status: ex.status,
      errorCode: typeof details?.error === 'string' ? (details.error as string) : undefined,
      details: details?.details,
    };
  }
  if (ex instanceof Error) return { message: ex.message || fallbackMessage };
  return { message: fallbackMessage };
}

export function useSubmitOrder() {
  const { session } = useAuth();
  const token = session?.accessToken;
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);
  const [lastResult, setLastResult] = useState<SaleDetailView | null>(null);
  const lastArgsRef = useRef<SubmitArgs | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setIdempotencyKey(null);
    setSaleId(null);
    setError(null);
    setLastResult(null);
    lastArgsRef.current = null;
  }, []);

  const buildPayload = (args: SubmitArgs): CreateSalePayload => {
    const backendOrderType = UI_TO_BACKEND_ORDER_TYPE[args.orderType];
    if (!ALLOWED_ORDER_TYPE_VALUES.has(backendOrderType)) {
      throw new Error(`Loại đơn không hợp lệ: ${args.orderType}`);
    }
    const lineGross = args.lines.map((l) => args.lineUnitPrice(l));
    const subtotal = args.subtotal > 0 ? args.subtotal : lineGross.reduce((s, v) => s + v, 0);
    const totalDiscount = Math.max(0, args.discount ?? 0);
    const totalTax = Math.max(0, args.vat ?? 0);

    let allocatedDiscount = 0;
    let allocatedTax = 0;
    const items: CreateSalePayload['items'] = args.lines.map((l, idx) => {
      const gross = lineGross[idx];
      const ratio = subtotal > 0 ? gross / subtotal : 0;
      let lineDiscount: number;
      let lineTax: number;
      if (idx === args.lines.length - 1) {
        lineDiscount = Math.max(0, totalDiscount - allocatedDiscount);
        lineTax = Math.max(0, totalTax - allocatedTax);
      } else {
        lineDiscount = Math.round(totalDiscount * ratio);
        lineTax = Math.round(totalTax * ratio);
        allocatedDiscount += lineDiscount;
        allocatedTax += lineTax;
      }
      const item: CreateSalePayload['items'][number] = {
        productId: l.itemId,
        quantity: l.quantity,
        discountAmount: lineDiscount,
        taxAmount: lineTax,
        note: null,
        promotionIds: [],
      };
      return item;
    });

    return {
      outletId: args.outletId,
      posSessionId: args.posSessionId ?? undefined,
      currencyCode: args.currencyCode,
      orderType: backendOrderType,
      note: args.customerName ?? null,
      items,
    };
  };

  const pickAmount = (sale: SaleDetailView, fallback: number): number => {
    const raw = sale.totalAmount;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    return fallback;
  };

  const doApprove = async (createdSaleId: string): Promise<boolean> => {
    setPhase('approving');
    try {
      await salesApi.approveOrder(token!, createdSaleId);
      setPhase('approved');
      return true;
    } catch (ex) {
      const err = toSubmitError(ex, 'Không duyệt được đơn');
      setError(err);
      setPhase('approve_failed');
      return false;
    }
  };

  const doPayment = async (args: SubmitArgs, createdSaleId: string, sale: SaleDetailView, key: string) => {
    const backendMethod = UI_TO_BACKEND_METHOD[args.method];
    if (!ALLOWED_METHOD_VALUES.has(backendMethod)) {
      setError({ message: `Phương thức thanh toán không hợp lệ: ${args.method}` });
      setPhase('payment_failed');
      return;
    }
    const amount = pickAmount(sale, args.previewTotal);
    setPhase('paying');
    try {
      await salesApi.markPaymentDone(token!, createdSaleId, {
        paymentMethod: backendMethod,
        amount,
        paymentTime: new Date().toISOString(),
      });
      setPhase('paid');
      removeSnapshot(key);
    } catch (ex) {
      const err = toSubmitError(ex, 'Không ghi nhận được thanh toán');
      setError(err);
      setPhase('payment_failed');
    }
  };

  const submit = useCallback(async (args: SubmitArgs) => {
    if (!token) {
      setError({ message: 'Chưa đăng nhập' });
      setPhase('create_failed');
      return;
    }
    if (!args.currencyCode) {
      setError({ message: 'Outlet chưa cấu hình đơn vị tiền tệ' });
      setPhase('create_failed');
      return;
    }
    lastArgsRef.current = args;
    const key = crypto.randomUUID();
    setIdempotencyKey(key);
    setError(null);

    let payload: CreateSalePayload;
    try {
      payload = buildPayload(args);
    } catch (ex) {
      const err = toSubmitError(ex, 'Payload không hợp lệ');
      setError(err);
      setPhase('create_failed');
      return;
    }

    const snapshot: PendingSnapshot = {
      idempotencyKey: key,
      phase: 'creating',
      outletId: args.outletId,
      currencyCode: args.currencyCode,
      createdAt: new Date().toISOString(),
      lines: args.lines,
      previewTotal: args.previewTotal,
      method: args.method,
      orderType: args.orderType,
    };
    saveSnapshot(snapshot);
    setPhase('creating');

    let sale: SaleDetailView;
    try {
      sale = await salesApi.createOrder(token, payload, { idempotencyKey: key });
      setSaleId(sale.id);
      setLastResult(sale);
      setPhase('created');
      saveSnapshot({ ...snapshot, phase: 'created', saleId: sale.id, backendTotal: sale.totalAmount ?? null });
    } catch (ex) {
      const err = toSubmitError(ex, 'Không tạo được đơn');
      setError(err);
      setPhase('create_failed');
      saveSnapshot({ ...snapshot, phase: 'create_failed', error: err.message });
      return;
    }

    const approved = await doApprove(sale.id);
    if (!approved) return;
    await doPayment(args, sale.id, sale, key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const retryApprove = useCallback(async () => {
    const args = lastArgsRef.current;
    if (!token || !saleId || !idempotencyKey || !args || !lastResult) return;
    setError(null);
    const approved = await doApprove(saleId);
    if (!approved) return;
    await doPayment(args, saleId, lastResult, idempotencyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, saleId, idempotencyKey, lastResult]);

  const retryPayment = useCallback(async () => {
    const args = lastArgsRef.current;
    if (!token || !saleId || !idempotencyKey || !args || !lastResult) return;
    setError(null);
    await doPayment(args, saleId, lastResult, idempotencyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, saleId, idempotencyKey, lastResult]);

  const retryCreate = useCallback(async () => {
    const args = lastArgsRef.current;
    if (!token || !idempotencyKey || !args) return;
    setError(null);
    setPhase('creating');
    try {
      const payload = buildPayload(args);
      const sale = await salesApi.createOrder(token, payload, { idempotencyKey });
      setSaleId(sale.id);
      setLastResult(sale);
      setPhase('created');
      const approved = await doApprove(sale.id);
      if (!approved) return;
      await doPayment(args, sale.id, sale, idempotencyKey);
    } catch (ex) {
      const err = toSubmitError(ex, 'Không tạo được đơn');
      setError(err);
      setPhase('create_failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, idempotencyKey]);

  return {
    phase,
    saleId,
    idempotencyKey,
    error,
    lastResult,
    submit,
    retryPayment,
    retryCreate,
    retryApprove,
    reset,
  };
}
