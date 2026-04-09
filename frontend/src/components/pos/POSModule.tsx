import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Monitor } from 'lucide-react';
import { POSSessionList } from '@/components/pos/POSSessionList';
import { OpenPOSSession } from '@/components/pos/OpenPOSSession';
import { POSSessionDetail } from '@/components/pos/POSSessionDetail';
import { OrderEntry } from '@/components/pos/OrderEntry';
import { SaleOrderDetail } from '@/components/pos/SaleOrderDetail';
import { PaymentCapture } from '@/components/pos/PaymentCapture';
import { CancelOrder } from '@/components/pos/CancelOrder';
import { CloseSession } from '@/components/pos/CloseSession';
import { ReconcileSession } from '@/components/pos/ReconcileSession';
import { OutletStatsPanel } from '@/components/pos/OutletStatsPanel';
import { EmptyState } from '@/components/shell/PermissionStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { POSSession, SaleOrder, OrderLineItem, PaymentMethod } from '@/types/pos';
import { usePOSSessions, type DBPosSession } from '@/hooks/use-pos-sessions';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import {
  crmApi,
  productApi,
  salesApi,
  type CrmCustomerView,
  type OrderingTableView,
  type ProductView,
  type SaleDetailView,
  type SaleLineItemView,
  type SaleListItemView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { normalizeNumericId } from '@/constants/pos';
import { toast } from 'sonner';

type POSView =
  | { screen: 'list' }
  | { screen: 'open-session' }
  | { screen: 'session-detail'; sessionId: string }
  | { screen: 'edit-session'; sessionId: string }
  | { screen: 'order-entry'; sessionId: string }
  | { screen: 'order-detail'; orderId: string }
  | { screen: 'payment'; sessionId: string; orderId?: string; items: OrderLineItem[]; promo: string | null; total: number; subtotal: number; taxAmount: number; promoDiscount: number }
  | { screen: 'cancel-order'; orderId: string }
  | { screen: 'close-session'; sessionId: string }
  | { screen: 'reconcile'; sessionId: string }
  | { screen: 'customers' }
  | { screen: 'outlet-stats' }
  | { screen: 'tables' };

interface Props {
  outletName: string;
  operatorName: string;
  outletId?: string;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toLong(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

type PaymentCompletionResult = {
  ok: boolean;
  errorMessage?: string;
};

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function distributeAmountAcrossItems(items: OrderLineItem[], totalAmount: number) {
  if (items.length === 0) {
    return [];
  }
  const totalLineAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (Math.abs(totalAmount) < 0.005 || totalLineAmount <= 0) {
    return items.map(() => 0);
  }

  let remaining = roundCurrency(totalAmount);
  return items.map((item, index) => {
    if (index === items.length - 1) {
      return remaining;
    }
    const share = roundCurrency((item.lineTotal / totalLineAmount) * totalAmount);
    remaining = roundCurrency(remaining - share);
    return share;
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function mapSaleToUi(
  sale: SaleListItemView,
  detail: SaleDetailView | null,
  outletName: string,
  operatorName: string,
  sessionCodeById: Map<string, string>,
  productNameById: Map<string, string>,
): SaleOrder {
  const status = String((detail?.status ?? sale?.status ?? '')).toLowerCase();
  const paymentStatusRaw = String((detail?.paymentStatus ?? sale?.paymentStatus ?? '')).toLowerCase();
  const sessionId = detail?.posSessionId != null ? String(detail.posSessionId) : sale?.posSessionId != null ? String(sale.posSessionId) : '';

  const lineItems: OrderLineItem[] = Array.isArray(detail?.items)
    ? detail.items.map((item: SaleLineItemView, index: number) => {
        const productId = String(item.productId ?? '');
        return {
          id: `${sale.id}-li-${index}`,
          productId,
          productName: productNameById.get(productId) || `Product ${productId || index + 1}`,
          category: 'Product',
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          lineTotal: toNumber(item.lineTotal),
        };
      })
    : [];

  const payments = detail?.payment
    ? [{
        id: `${sale.id}-pay-1`,
        method: String(detail.payment.paymentMethod ?? 'cash') as PaymentMethod,
        amount: toNumber(detail.payment.amount),
        capturedAt: String(detail.payment.paymentTime ?? detail.createdAt ?? new Date().toISOString()),
        reference: detail.payment.transactionRef ? String(detail.payment.transactionRef) : undefined,
      }]
    : [];

  return {
    id: String(sale.id),
    orderNumber: `SO-${String(sale.id).slice(-6)}`,
    sessionId,
    sessionCode: sessionCodeById.get(sessionId) || '—',
    backendStatus: status,
    outletName,
    createdBy: operatorName,
    createdAt: String(detail?.createdAt ?? sale?.createdAt ?? new Date().toISOString()),
    status: status === 'cancelled' ? 'cancelled' : (status === 'payment_done' || status === 'completed' ? 'completed' : 'open'),
    paymentStatus: paymentStatusRaw === 'paid' ? 'paid' : paymentStatusRaw === 'partially_paid' ? 'partial' : 'unpaid',
    lineItems,
    subtotal: toNumber(detail?.subtotal ?? sale?.subtotal),
    taxAmount: toNumber(detail?.taxAmount ?? sale?.taxAmount),
    total: toNumber(detail?.totalAmount ?? sale?.totalAmount),
    tableNumber: detail?.orderingTableCode ? String(detail.orderingTableCode) : sale?.orderingTableCode ? String(sale.orderingTableCode) : undefined,
    payments,
  };
}

export function POSModule({ outletName, operatorName, outletId }: Props) {
  const { token, scope } = useShellRuntime();
  const [view, setView] = useState<POSView>({ screen: 'list' });
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersMap, setOrdersMap] = useState<Record<string, SaleOrder>>({});
  const [productNameById, setProductNameById] = useState<Map<string, string>>(new Map());
  const [customers, setCustomers] = useState<CrmCustomerView[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [orderingTables, setOrderingTables] = useState<OrderingTableView[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [tableStatusFilter, setTableStatusFilter] = useState('all');

  const {
    sessions: dbSessions,
    loading,
    createSession,
    updateSession,
    closeSession: dbClose,
    reconcileSession: dbReconcile,
    deleteSession,
  } = usePOSSessions();

  const scopedOutletId = normalizeNumericId(outletId || scope.outletId);

  const goList = useCallback(() => setView({ screen: 'list' }), []);

  useEffect(() => {
    const loadProducts = async () => {
      if (!token) {
        setProductNameById(new Map());
        return;
      }
      try {
        const products = await productApi.products(token);
        const next = new Map<string, string>();
        products.forEach((product: ProductView) => {
          next.set(String(product.id), String(product.name ?? `Product ${product.id}`));
        });
        setProductNameById(next);
      } catch (error) {
        console.error('Failed to load product names for POS orders', error);
      }
    };
    void loadProducts();
  }, [token]);

  const sessions: POSSession[] = useMemo(() => {
    const orderAgg = new Map<string, { orderCount: number; revenue: number; paymentSummary: Map<PaymentMethod, { total: number; count: number }> }>();

    orders.forEach((order) => {
      const key = order.sessionId;
      if (!key) return;
      const existing = orderAgg.get(key) || { orderCount: 0, revenue: 0, paymentSummary: new Map() };
      existing.orderCount += 1;
      existing.revenue += order.total;
      order.payments.forEach((payment) => {
        const current = existing.paymentSummary.get(payment.method) || { total: 0, count: 0 };
        current.total += payment.amount;
        current.count += 1;
        existing.paymentSummary.set(payment.method, current);
      });
      orderAgg.set(key, existing);
    });

    return dbSessions.map((session) => {
      const stats = orderAgg.get(session.id);
      return {
        id: session.id,
        code: `POS-${session.opened_at.slice(0, 10).replace(/-/g, '')}-${session.id.slice(0, 3).toUpperCase()}`,
        outletId: session.outlet_id,
        outletName: session.outlet_name || 'Unknown',
        currencyCode: session.currency_code || undefined,
        businessDate: session.opened_at.slice(0, 10),
        openedBy: 'Operator',
        openedAt: session.opened_at,
        status: session.status as POSSession['status'],
        closedAt: session.closed_at || undefined,
        openingNote: session.notes || undefined,
        orderCount: stats?.orderCount || 0,
        totalRevenue: stats?.revenue || 0,
        paymentSummary: stats
          ? Array.from(stats.paymentSummary.entries()).map(([method, value]) => ({
              method,
              total: value.total,
              count: value.count,
            }))
          : [],
      };
    });
  }, [dbSessions, orders]);

  const fetchOrders = useCallback(async () => {
    if (!token) {
      setOrders([]);
      setOrdersMap({});
      return;
    }

    setOrdersLoading(true);
    try {
      const page = await salesApi.orders(token, {
        outletId: scopedOutletId || undefined,
        limit: 50,
        offset: 0,
      });

      const sessionCodeById = new Map(
        dbSessions.map((session) => [
          session.id,
          `POS-${session.opened_at.slice(0, 10).replace(/-/g, '')}-${session.id.slice(0, 3).toUpperCase()}`,
        ]),
      );
      const baseItems = page.items || [];
      const detailResponses = await Promise.all(
        baseItems.map(async (item: SaleListItemView) => {
          try {
            return await salesApi.orderDetail(token, String(item.id));
          } catch {
            return null;
          }
        }),
      );

      const mapped = baseItems.map((item: SaleListItemView, index: number) =>
        mapSaleToUi(item, detailResponses[index], outletName, operatorName, sessionCodeById, productNameById),
      );

      const detailMap: Record<string, SaleOrder> = {};
      mapped.forEach((order) => {
        detailMap[order.id] = order;
      });

      setOrders(mapped);
      setOrdersMap(detailMap);
    } catch (error) {
      console.error('Failed to load sale orders:', error);
      toast.error('Unable to load sale orders');
      setOrders([]);
      setOrdersMap({});
    } finally {
      setOrdersLoading(false);
    }
  }, [dbSessions, operatorName, outletName, productNameById, scopedOutletId, token]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const loadCustomers = useCallback(async (query = customerQuery) => {
    if (!token) {
      setCustomers([]);
      setCustomersError('');
      return;
    }
    setCustomersLoading(true);
    setCustomersError('');
    try {
      const page = await crmApi.customers(token, {
        outletId: scopedOutletId || undefined,
        query: query.trim() || undefined,
        limit: 100,
        offset: 0,
      });
      setCustomers(page.items || []);
    } catch (error: unknown) {
      console.error('POS customer load failed:', error);
      setCustomers([]);
      setCustomersError(getErrorMessage(error, 'Unable to load customers'));
    } finally {
      setCustomersLoading(false);
    }
  }, [customerQuery, scopedOutletId, token]);

  const loadOrderingTables = useCallback(async (status = tableStatusFilter) => {
    if (!token) {
      setOrderingTables([]);
      setTablesError('');
      return;
    }
    if (!scopedOutletId) {
      setOrderingTables([]);
      setTablesError('Select an outlet scope to load ordering tables');
      return;
    }
    setTablesLoading(true);
    setTablesError('');
    try {
      const rows = await salesApi.orderingTables(token, scopedOutletId, status === 'all' ? undefined : status);
      setOrderingTables(Array.isArray(rows) ? rows : []);
    } catch (error: unknown) {
      console.error('POS ordering tables load failed:', error);
      setOrderingTables([]);
      setTablesError(getErrorMessage(error, 'Unable to load ordering tables'));
    } finally {
      setTablesLoading(false);
    }
  }, [scopedOutletId, tableStatusFilter, token]);

  useEffect(() => {
    if (view.screen === 'customers' && customers.length === 0 && !customersLoading && !customersError) {
      void loadCustomers();
    }
    if (view.screen === 'tables' && orderingTables.length === 0 && !tablesLoading && !tablesError) {
      void loadOrderingTables();
    }
  }, [
    customers.length,
    customersError,
    customersLoading,
    loadCustomers,
    loadOrderingTables,
    orderingTables.length,
    tablesError,
    tablesLoading,
    view.screen,
  ]);

  useEffect(() => {
    // Reset outlet-scoped references so active tab reloads with current scope.
    setCustomers([]);
    setCustomersError('');
    setCustomerQuery('');
    setOrderingTables([]);
    setTablesError('');
    setTableStatusFilter('all');
  }, [scopedOutletId, token]);

  const getSession = useCallback((id: string) => sessions.find((session) => session.id === id), [sessions]);
  const getDbSession = useCallback((id: string) => dbSessions.find((session) => session.id === id), [dbSessions]);
  const getOrder = useCallback((id: string) => ordersMap[id] || orders.find((order) => order.id === id), [orders, ordersMap]);
  const hasOpenSession = sessions.some((session) => session.status === 'open');

  const handleCreateSession = useCallback(async (note?: string) => {
    const targetOutlet = normalizeNumericId(outletId || scope.outletId || dbSessions[0]?.outlet_id);
    if (!targetOutlet) {
      toast.error('No numeric outlet available. Configure outlet scope in Settings first.');
      return;
    }
    const result = await createSession(targetOutlet, 200, note);
    if (result) {
      setView({ screen: 'session-detail', sessionId: result.id });
    }
  }, [createSession, dbSessions, outletId, scope.outletId]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    const closed = await dbClose(sessionId, 0);
    if (closed) {
      goList();
    }
  }, [dbClose, goList]);

  const handleReconcileSession = useCallback(async (
    sessionId: string,
    payload: {
      lines: Array<{ paymentMethod: string; actualAmount: number }>;
      note?: string;
    },
  ) => {
    const reconciled = await dbReconcile(sessionId, payload);
    if (reconciled) {
      await fetchOrders();
      setView({ screen: 'session-detail', sessionId });
    }
  }, [dbReconcile, fetchOrders]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId);
    goList();
  }, [deleteSession, goList]);

  const handleEditSession = useCallback(async (sessionId: string, updates: { notes?: string; opening_float?: number }) => {
    await updateSession(sessionId, { notes: updates.notes, opening_float: updates.opening_float });
    setView({ screen: 'session-detail', sessionId });
  }, [updateSession]);

  const handlePaymentComplete = useCallback(async (
    sessionId: string,
    orderId: string | undefined,
    items: OrderLineItem[],
    promo: string | null,
    total: number,
    _subtotal: number,
    taxAmount: number,
    promoDiscount: number,
    paymentMethod: PaymentMethod,
  ): Promise<PaymentCompletionResult> => {
    if (!token) {
      const message = 'Please sign in first';
      toast.error(message);
      return { ok: false, errorMessage: message };
    }

    const session = getSession(sessionId);
    const normalizedSessionId = normalizeNumericId(sessionId);
    const normalizedOutletId = normalizeNumericId(session?.outletId || scopedOutletId);
    if (!normalizedSessionId || !normalizedOutletId) {
      const message = 'Unable to create order: invalid outlet/session identifiers';
      toast.error(message);
      return { ok: false, errorMessage: message };
    }
    const currencyCode =
      typeof session?.currencyCode === 'string' && session.currencyCode.trim().length > 0
        ? session.currencyCode.trim().toUpperCase()
        : 'USD';

    type DraftSaleLine = {
      productId: number | null;
      quantity: number;
      discountAmount: number;
      taxAmount: number;
      note: null;
      promotionIds: number[];
    };

    const distributedTax = distributeAmountAcrossItems(items, taxAmount);
    const distributedDiscount = distributeAmountAcrossItems(items, promoDiscount);

    const saleLines = items
      .map((item, index): DraftSaleLine => {
        const productId = toLong(normalizeNumericId(item.productId));
        return {
          productId,
          quantity: item.quantity,
          discountAmount: distributedDiscount[index] || 0,
          taxAmount: distributedTax[index] || 0,
          note: null,
          promotionIds: (() => {
            const promoId = toLong(normalizeNumericId(promo ?? ''));
            return promoId ? [promoId] : [];
          })(),
        };
      })
      .filter((line): line is {
        productId: number;
        quantity: number;
        discountAmount: number;
        taxAmount: number;
        note: null;
        promotionIds: number[];
      } => line.productId !== null);

    if (saleLines.length === 0) {
      const message = 'No valid product lines were found for this order';
      toast.error(message);
      return { ok: false, errorMessage: message };
    }

    try {
      let targetSaleId = orderId;
      let approvedTotal = total;

      if (targetSaleId) {
        const existingOrder = getOrder(targetSaleId);
        if (!existingOrder) {
          throw new Error(`Order not found: ${targetSaleId}`);
        }
        const backendStatus = String(existingOrder.backendStatus ?? '').toLowerCase();
        if (backendStatus !== 'order_approved') {
          const approved = toRecord(await salesApi.approveOrder(token, targetSaleId));
          const backendTotal = Number(approved?.totalAmount);
          if (Number.isFinite(backendTotal)) {
            approvedTotal = backendTotal;
          }
        } else {
          approvedTotal = existingOrder.total;
        }
      } else {
        const created = toRecord(await salesApi.createOrder(token, {
          outletId: normalizedOutletId,
          posSessionId: normalizedSessionId,
          currencyCode,
          orderType: 'takeaway',
          note: promo ? `promo:${promo}` : null,
          items: saleLines,
        }));
        if (created?.id == null) {
          throw new Error('Order creation response is missing id');
        }

        targetSaleId = String(created.id);
        const approved = toRecord(await salesApi.approveOrder(token, targetSaleId));
        const backendTotal = Number(approved?.totalAmount ?? created.totalAmount);
        if (Number.isFinite(backendTotal)) {
          approvedTotal = backendTotal;
        }
      }

      await salesApi.markPaymentDone(token, targetSaleId, {
        paymentMethod,
        amount: Number.isFinite(approvedTotal) ? approvedTotal : total,
        paymentTime: new Date().toISOString(),
        note: 'Captured from POS payment screen',
      });

      await fetchOrders();
      toast.success('Order created and payment captured');
      setView({ screen: 'session-detail', sessionId });
      return { ok: true };
    } catch (error: unknown) {
      console.error('POS payment flow failed:', error);
      const message = getErrorMessage(error, 'Unable to create order/payment via backend APIs');
      toast.error(message);
      return { ok: false, errorMessage: message };
    }
  }, [fetchOrders, getOrder, getSession, scopedOutletId, token]);

  const handleCancelOrder = useCallback(async (orderId: string, reason: string) => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }
    const order = ordersMap[orderId] || orders.find((item) => item.id === orderId);
    try {
      await salesApi.cancelOrder(token, orderId, { reason: reason.trim() || null });
      toast.success('Order cancelled');
      await fetchOrders();
      if (order?.sessionId) {
        setView({ screen: 'session-detail', sessionId: order.sessionId });
      } else {
        goList();
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to cancel order'));
    }
  }, [fetchOrders, goList, orders, ordersMap, token]);

  if (loading) {
    return <div className="flex items-center justify-center h-full py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (view.screen === 'customers') {
    return (
      <POSCustomersScreen
        onBack={goList}
        loading={customersLoading}
        error={customersError}
        query={customerQuery}
        onQueryChange={setCustomerQuery}
        onSearch={() => void loadCustomers(customerQuery)}
        customers={customers}
      />
    );
  }

  if (view.screen === 'tables') {
    return (
      <POSTablesScreen
        onBack={goList}
        loading={tablesLoading}
        error={tablesError}
        statusFilter={tableStatusFilter}
        onStatusFilterChange={setTableStatusFilter}
        onRefresh={() => void loadOrderingTables(tableStatusFilter)}
        tables={orderingTables}
      />
    );
  }

  if (view.screen === 'outlet-stats') {
    return <OutletStatsPanel onBack={goList} />;
  }

  if (view.screen === 'list') {
    return (
      <POSSessionList
        sessions={sessions}
        onOpenSession={() => setView({ screen: 'open-session' })}
        onViewSession={(session) => setView({ screen: 'session-detail', sessionId: session.id })}
        onCloseSession={(session) => setView({ screen: 'close-session', sessionId: session.id })}
        onReconcile={(session) => setView({ screen: 'reconcile', sessionId: session.id })}
        onEditSession={(session) => setView({ screen: 'edit-session', sessionId: session.id })}
        onDeleteSession={(session) => handleDeleteSession(session.id)}
        onCustomers={() => setView({ screen: 'customers' })}
        onOutletStats={() => setView({ screen: 'outlet-stats' })}
        onTables={() => setView({ screen: 'tables' })}
      />
    );
  }

  if (view.screen === 'open-session') {
    return (
      <OpenPOSSession
        outletName={outletName}
        operatorName={operatorName}
        hasOpenSession={hasOpenSession}
        onBack={goList}
        onOpen={(note) => void handleCreateSession(note)}
      />
    );
  }

  if (view.screen === 'edit-session') {
    const dbSession = getDbSession(view.sessionId);
    if (!dbSession) return <div className="p-6 text-sm text-muted-foreground">Session not found</div>;
    return (
      <EditPOSSession
        session={dbSession}
        onBack={() => setView({ screen: 'session-detail', sessionId: view.sessionId })}
        onSave={(updates) => void handleEditSession(view.sessionId, updates)}
      />
    );
  }

  if (view.screen === 'session-detail') {
    const session = getSession(view.sessionId);
    if (!session) return <div className="p-6 text-sm text-muted-foreground">Session not found</div>;
    const sessionOrders = orders.filter((order) => order.sessionId === session.id);
    return (
      <POSSessionDetail
        session={session}
        orders={sessionOrders}
        onBack={goList}
        onClose={() => setView({ screen: 'close-session', sessionId: session.id })}
        onReconcile={() => setView({ screen: 'reconcile', sessionId: session.id })}
        onNewOrder={() => setView({ screen: 'order-entry', sessionId: session.id })}
        onViewOrder={(orderId) => setView({ screen: 'order-detail', orderId })}
      />
    );
  }

  if (view.screen === 'order-entry') {
    const session = getSession(view.sessionId);
    if (!session) return <div className="p-6 text-sm text-muted-foreground">Session not found</div>;
    return (
      <OrderEntry
        sessionCode={session.code}
        outletName={outletName}
        cashierName={operatorName}
        onBack={() => setView({ screen: 'session-detail', sessionId: view.sessionId })}
        onCheckout={(items, promo) => {
          const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
          const promoDiscount = 0;
          const adjustedSubtotal = subtotal - promoDiscount;
          const taxAmount = +(adjustedSubtotal * 0.08).toFixed(2);
          const total = +(adjustedSubtotal + taxAmount).toFixed(2);
          setView({ screen: 'payment', sessionId: view.sessionId, items, promo, total, subtotal, taxAmount, promoDiscount });
        }}
      />
    );
  }

  if (view.screen === 'order-detail') {
    const order = ordersMap[view.orderId] || orders.find((item) => item.id === view.orderId);
    if (ordersLoading && !order) {
      return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }
    if (!order) return <div className="p-6 text-sm text-muted-foreground">Order not found</div>;
    return (
      <SaleOrderDetail
        order={order}
        onBack={() => setView({ screen: 'session-detail', sessionId: order.sessionId })}
        onPay={() => setView({ screen: 'payment', sessionId: order.sessionId, orderId: order.id, items: order.lineItems, promo: order.promotionCode || null, total: order.total, subtotal: order.subtotal, taxAmount: order.taxAmount, promoDiscount: order.promotionDiscount || 0 })}
        onCancel={() => setView({ screen: 'cancel-order', orderId: order.id })}
      />
    );
  }

  if (view.screen === 'payment') {
    return (
      <PaymentCapture
        orderTotal={view.total}
        lineItems={view.items}
        promoCode={view.promo}
        promoDiscount={view.promoDiscount}
        subtotal={view.subtotal}
        taxAmount={view.taxAmount}
        onBack={() => setView({ screen: 'session-detail', sessionId: view.sessionId })}
        onComplete={(paymentMethod) => {
          return handlePaymentComplete(
            view.sessionId,
            view.orderId,
            view.items,
            view.promo,
            view.total,
            view.subtotal,
            view.taxAmount,
            view.promoDiscount,
            paymentMethod,
          );
        }}
      />
    );
  }

  if (view.screen === 'cancel-order') {
    const order = ordersMap[view.orderId] || orders.find((item) => item.id === view.orderId);
    if (!order) return <div className="p-6 text-sm text-muted-foreground">Order not found</div>;
    return (
      <CancelOrder
        order={order}
        onBack={() => setView({ screen: 'order-detail', orderId: order.id })}
        onConfirm={(reason) => {
          void handleCancelOrder(order.id, reason);
        }}
      />
    );
  }

  if (view.screen === 'close-session') {
    const session = getSession(view.sessionId);
    if (!session) return <div className="p-6 text-sm text-muted-foreground">Session not found</div>;
    return (
      <CloseSession
        session={session}
        onBack={() => setView({ screen: 'session-detail', sessionId: session.id })}
        onConfirm={() => void handleCloseSession(session.id)}
      />
    );
  }

  if (view.screen === 'reconcile') {
    const session = getSession(view.sessionId);
    if (!session) return <div className="p-6 text-sm text-muted-foreground">Session not found</div>;
    return (
      <ReconcileSession
        session={session}
        onBack={() => setView({ screen: 'session-detail', sessionId: session.id })}
        onConfirm={(payload) => handleReconcileSession(session.id, payload)}
      />
    );
  }

  return null;
}

function EditPOSSession({ session, onBack, onSave }: {
  session: DBPosSession;
  onBack: () => void;
  onSave: (updates: { notes?: string; opening_float?: number }) => void;
}) {
  const [notes, setNotes] = useState(session.notes || '');
  const [openingFloat, setOpeningFloat] = useState(String(session.opening_float));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      notes: notes || undefined,
      opening_float: parseFloat(openingFloat) || 0,
    });
    setSaving(false);
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back to session
      </button>
      <div className="max-w-lg mx-auto">
        <div className="surface-elevated p-6 space-y-6">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Monitor className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Edit POS Session</h2>
            <p className="text-sm text-muted-foreground mt-1">Update session details</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Opening Float ($)</Label>
              <Input
                type="number"
                value={openingFloat}
                onChange={(event) => setOpeningFloat(event.target.value)}
                className="mt-1 h-9"
                disabled={session.status !== 'open'}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 h-9"
                placeholder="Session notes..."
              />
            </div>
          </div>
          <Button className="w-full h-10" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function POSCustomersScreen({
  onBack,
  loading,
  error,
  query,
  onQueryChange,
  onSearch,
  customers,
}: {
  onBack: () => void;
  loading: boolean;
  error: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  customers: CrmCustomerView[];
}) {
  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div className="surface-elevated p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h3 className="text-sm font-semibold">Customer References ({customers.length})</h3>
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-64 text-xs"
              placeholder="Search customers"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch();
              }}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onSearch} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            description="No customer-reference rows were returned for the current scope and search filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Customer', 'Reference', 'Outlet', 'Orders', 'Total Spend', 'Last Order'].map((header) => (
                    <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-xs">{customer.displayName || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{customer.referenceType || '—'} · {customer.id}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {customer.outletName || customer.outletCode || customer.outletId || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{customer.orderCount}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{customer.totalSpend}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(customer.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function POSTablesScreen({
  onBack,
  loading,
  error,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  tables,
}: {
  onBack: () => void;
  loading: boolean;
  error: string;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
  tables: OrderingTableView[];
}) {
  const copyPublicPath = async (tableToken: string) => {
    const value = `/order/${tableToken}`;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Public ordering route copied');
    } catch {
      toast.error('Unable to copy route');
    }
  };

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div className="surface-elevated p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h3 className="text-sm font-semibold">Ordering Tables ({tables.length})</h3>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-3 text-xs"
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tables.length === 0 ? (
          <EmptyState
            title="No tables found"
            description="No ordering-table links were returned for the current outlet and status filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Table', 'Status', 'Outlet', 'Public Route', 'Action'].map((header) => (
                    <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tables.map((table: OrderingTableView) => (
                  <tr key={String(table.tableToken)} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-xs">
                      {String(table.tableName || table.name || table.tableCode || table.code || '—')}
                      <span className="text-muted-foreground"> · {String(table.tableCode || table.code || '—')}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(table.status || '—')}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(table.outletName || table.outletCode || table.outletId || '—')}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{`/order/${String(table.tableToken || '')}`}</td>
                    <td className="px-4 py-2.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() => {
                          void copyPublicPath(String(table.tableToken || ''));
                        }}
                      >
                        Copy Route
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
