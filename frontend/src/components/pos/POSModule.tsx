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
import { EmptyState, PermissionBanner } from '@/components/shell/PermissionStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiError } from '@/api/client';
import type { POSSession, SaleOrder, OrderLineItem, PaymentMethod } from '@/types/pos';
import { usePOSSessions, type DBPosSession } from '@/hooks/use-pos-sessions';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import {
  authApi,
  crmApi,
  productApi,
  salesApi,
  type CrmCustomerView,
  type OrderingTableView,
  type ProductView,
  type SaleListItemView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { normalizeNumericId } from '@/constants/pos';
import {
  distributeAmountAcrossItems,
  mapSaleToUi,
} from '@/components/pos/sale-order-utils';
import {
  hasCrmReadAccess,
  hasPosOrderingTableAccess,
} from '@/auth/authorization';
import { useAuth } from '@/auth/use-auth';
import type { PermissionState } from '@/types/shell';
import { reportError } from '@/lib/report-error';
import { cn } from '@/lib/utils';
import { roundMoney } from '@/lib/money';
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

type PaymentCompletionResult = {
  ok: boolean;
  errorMessage?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function resolveCapabilityState(error: unknown): PermissionState | null {
  if (!isApiError(error)) return null;
  if (error.status === 401 || error.status === 403) return 'action_disabled';
  if (error.status === 404 || error.status === 405 || error.status === 501) return 'route_unavailable';
  if (error.status >= 500) return 'service_unavailable';
  return null;
}

export function POSModule({ outletName, operatorName, outletId }: Props) {
  const { session } = useAuth();
  const { token, scope } = useShellRuntime();
  const [view, setView] = useState<POSView>({ screen: 'list' });
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderDetailLoadingId, setOrderDetailLoadingId] = useState('');
  const [ordersMap, setOrdersMap] = useState<Record<string, SaleOrder>>({});
  const [productNameById, setProductNameById] = useState<Map<string, string>>(new Map());
  const [customers, setCustomers] = useState<CrmCustomerView[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [customersErrorState, setCustomersErrorState] = useState<PermissionState | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [orderingTables, setOrderingTables] = useState<OrderingTableView[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [tablesErrorState, setTablesErrorState] = useState<PermissionState | null>(null);
  const [tableStatusFilter, setTableStatusFilter] = useState('all');

  const {
    sessions: dbSessions,
    totalSessions,
    page: sessionsPage,
    pageSize: sessionsPageSize,
    setPage: setSessionsPage,
    loading,
    createSession,
    updateSession,
    reconcileSession: dbReconcile,
    deleteSession,
  } = usePOSSessions();

  const scopedOutletId = normalizeNumericId(outletId || scope.outletId);
  const canAccessCustomerReferences = hasCrmReadAccess(session);
  const canAccessOrderingTables = hasPosOrderingTableAccess(session);

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
        reportError(error, 'pos.product-names.load');
      }
    };
    void loadProducts();
  }, [token]);

  const sessions: POSSession[] = useMemo(() => {
    const orderAgg = new Map<string, { orderCount: number; revenue: number; collected: number; paymentSummary: Map<PaymentMethod, { total: number; count: number }> }>();

    orders.forEach((order) => {
      const key = order.sessionId;
      if (!key) return;
      const existing = orderAgg.get(key) || { orderCount: 0, revenue: 0, collected: 0, paymentSummary: new Map() };
      existing.orderCount += 1;
      existing.revenue += order.total;
      order.payments.forEach((payment) => {
        const current = existing.paymentSummary.get(payment.method) || { total: 0, count: 0 };
        current.total += payment.amount;
        current.count += 1;
        existing.collected += payment.amount;
        existing.paymentSummary.set(payment.method, current);
      });
      orderAgg.set(key, existing);
    });

    return dbSessions.map((session) => {
      const stats = orderAgg.get(session.id);
      const backendRevenue = session.total_revenue || 0;
      const backendOrderCount = session.order_count || 0;
      const hasLoadedOrders = (stats?.orderCount || 0) >= backendOrderCount && backendOrderCount > 0;
      const totalRevenue = backendRevenue > 0 ? backendRevenue : (stats?.revenue || 0);
      const totalCollected = stats?.collected || 0;
      const outstandingAmount = hasLoadedOrders ? Math.max(0, totalRevenue - totalCollected) : 0;
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
        orderCount: backendOrderCount || stats?.orderCount || 0,
        totalRevenue,
        totalCollected,
        outstandingAmount,
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

  const buildSessionContext = useCallback(async () => {
    const sessionCodeById = new Map(
      dbSessions.map((session) => [
        session.id,
        `POS-${session.opened_at.slice(0, 10).replace(/-/g, '')}-${session.id.slice(0, 3).toUpperCase()}`,
      ]),
    );

    const operatorIds = Array.from(new Set(
      dbSessions.map((s) => s.operator_id).filter((v) => v && v.trim() !== ''),
    ));
    const userNameById = new Map<string, string>();
    if (operatorIds.length > 0 && token) {
      try {
        const usersPage = await authApi.users(token, { limit: 200 });
        for (const u of usersPage.items) {
          userNameById.set(String(u.id), u.fullName || u.username || String(u.id));
        }
      } catch {
        // ignore — fallback to operatorName prop
      }
    }
    const sessionOperatorNameById = new Map<string, string>();
    for (const s of dbSessions) {
      const name = userNameById.get(s.operator_id);
      if (name) sessionOperatorNameById.set(s.id, name);
    }
    return { sessionCodeById, sessionOperatorNameById };
  }, [dbSessions, token]);

  const loadOrdersWithContext = useCallback(async (
    items: SaleListItemView[],
    context: { sessionCodeById: Map<string, string>; sessionOperatorNameById: Map<string, string> },
  ): Promise<SaleOrder[]> => {
    if (!token || items.length === 0) return [];
    return items.map((item) =>
      mapSaleToUi(
        item,
        null,
        outletName,
        operatorName,
        context.sessionCodeById,
        productNameById,
        context.sessionOperatorNameById,
      ),
    );
  }, [operatorName, outletName, productNameById, token]);

  const mergeOrdersIntoState = useCallback((incoming: SaleOrder[]) => {
    if (incoming.length === 0) return;
    setOrders((prev) => {
      const map = new Map(prev.map((o) => [o.id, o]));
      incoming.forEach((o) => map.set(o.id, o));
      return Array.from(map.values());
    });
    setOrdersMap((prev) => {
      const next = { ...prev };
      incoming.forEach((o) => { next[o.id] = o; });
      return next;
    });
  }, []);

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
      const context = await buildSessionContext();
      const mapped = await loadOrdersWithContext(page.items || [], context);
      setOrders(mapped);
      const detailMap: Record<string, SaleOrder> = {};
      mapped.forEach((o) => { detailMap[o.id] = o; });
      setOrdersMap(detailMap);
    } catch (error) {
      reportError(error, 'pos.sale-orders.load');
      toast.error(getErrorMessage(error, 'Unable to load sale orders'));
      setOrders([]);
      setOrdersMap({});
    } finally {
      setOrdersLoading(false);
    }
  }, [buildSessionContext, loadOrdersWithContext, scopedOutletId, token]);

  const fetchOrdersForSession = useCallback(async (sessionId: string, includeDetails = false) => {
    if (!token || !sessionId) return;
    setOrdersLoading(true);
    try {
      const page = await salesApi.orders(token, {
        posSessionId: sessionId,
        limit: 500,
        offset: 0,
      });
      const context = await buildSessionContext();
      const rows = page.items || [];
      const rowsWithDetails = includeDetails
        ? await Promise.all(rows.map(async (item) => {
            try {
              return await salesApi.orderDetail(token, item.id);
            } catch {
              return item;
            }
          }))
        : rows;
      const mapped = includeDetails
        ? rowsWithDetails.map((item) =>
            mapSaleToUi(
              item,
              item,
              outletName,
              operatorName,
              context.sessionCodeById,
              productNameById,
              context.sessionOperatorNameById,
            ),
          )
        : await loadOrdersWithContext(rowsWithDetails, context);
      mergeOrdersIntoState(mapped);
    } catch (error) {
      reportError(error, 'pos.session-orders.load');
      toast.error(getErrorMessage(error, 'Unable to load orders for this session'));
    } finally {
      setOrdersLoading(false);
    }
  }, [buildSessionContext, loadOrdersWithContext, mergeOrdersIntoState, operatorName, outletName, productNameById, token]);

  const ensureOrderDetail = useCallback(async (orderId: string) => {
    if (!token || !orderId) return;

    const existing = ordersMap[orderId] || orders.find((order) => order.id === orderId);
    if (existing?.lineItems.length && (existing.paymentStatus !== 'paid' || existing.payments.length > 0)) {
      return;
    }

    setOrderDetailLoadingId(orderId);
    try {
      const detail = await salesApi.orderDetail(token, orderId);
      const context = await buildSessionContext();
      mergeOrdersIntoState([
        mapSaleToUi(
          detail,
          detail,
          outletName,
          operatorName,
          context.sessionCodeById,
          productNameById,
          context.sessionOperatorNameById,
        ),
      ]);
    } catch (error) {
      reportError(error, 'pos.sale-order-detail.load');
      toast.error(getErrorMessage(error, 'Unable to load sale order detail'));
    } finally {
      setOrderDetailLoadingId((current) => current === orderId ? '' : current);
    }
  }, [buildSessionContext, mergeOrdersIntoState, operatorName, orders, ordersMap, outletName, productNameById, token]);

  const handleViewOrder = useCallback((orderId: string) => {
    setView({ screen: 'order-detail', orderId });
    void ensureOrderDetail(orderId);
  }, [ensureOrderDetail]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (view.screen === 'session-detail' || view.screen === 'close-session' || view.screen === 'reconcile') {
      void fetchOrdersForSession(view.sessionId, true);
    }
  }, [fetchOrdersForSession, view]);

  const loadCustomers = useCallback(async (query = customerQuery) => {
    if (!token) {
      setCustomers([]);
      setCustomersError('');
      setCustomersErrorState(null);
      return;
    }
    setCustomersLoading(true);
    setCustomersError('');
    setCustomersErrorState(null);
    try {
      const page = await crmApi.customers(token, {
        outletId: scopedOutletId || undefined,
        query: query.trim() || undefined,
        limit: 100,
        offset: 0,
      });
      setCustomers(page.items || []);
    } catch (error: unknown) {
      reportError(error, 'pos.customers.load');
      setCustomers([]);
      setCustomersError(getErrorMessage(error, 'Unable to load customers'));
      setCustomersErrorState(resolveCapabilityState(error));
    } finally {
      setCustomersLoading(false);
    }
  }, [customerQuery, scopedOutletId, token]);

  const loadOrderingTables = useCallback(async (status = tableStatusFilter) => {
    if (!token) {
      setOrderingTables([]);
      setTablesError('');
      setTablesErrorState(null);
      return;
    }
    if (!scopedOutletId) {
      setOrderingTables([]);
      setTablesError('Select an outlet scope to load ordering tables');
      setTablesErrorState(null);
      return;
    }
    setTablesLoading(true);
    setTablesError('');
    setTablesErrorState(null);
    try {
      const rows = await salesApi.orderingTables(token, scopedOutletId, status === 'all' ? undefined : status);
      setOrderingTables(Array.isArray(rows) ? rows : []);
    } catch (error: unknown) {
      reportError(error, 'pos.ordering-tables.load');
      setOrderingTables([]);
      setTablesError(getErrorMessage(error, 'Unable to load ordering tables'));
      setTablesErrorState(resolveCapabilityState(error));
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
    setCustomersErrorState(null);
    setCustomerQuery('');
    setOrderingTables([]);
    setTablesError('');
    setTablesErrorState(null);
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

  const handleCloseSession = useCallback(async (
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
    paymentNote?: string,
    totalCharged?: number,
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
      productId: string | null;
      quantity: number;
      discountAmount: number;
      taxAmount: number;
      note: null;
      promotionIds: string[];
    };

    const distributedTax = distributeAmountAcrossItems(items, taxAmount);
    const distributedDiscount = distributeAmountAcrossItems(items, promoDiscount);

    const saleLines = items
      .map((item, index): DraftSaleLine => {
        const productId = normalizeNumericId(item.productId);
        return {
          productId,
          quantity: item.quantity,
          discountAmount: distributedDiscount[index] || 0,
          taxAmount: distributedTax[index] || 0,
          note: null,
          promotionIds: (() => {
            const promoId = normalizeNumericId(promo ?? '');
            return promoId ? [promoId] : [];
          })(),
        };
      })
      .filter((line): line is {
        productId: string;
        quantity: number;
        discountAmount: number;
        taxAmount: number;
        note: null;
        promotionIds: string[];
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

      const finalAmount = Number.isFinite(totalCharged) && (totalCharged ?? 0) > 0
        ? totalCharged!
        : (Number.isFinite(approvedTotal) ? approvedTotal : total);
      await salesApi.markPaymentDone(token, targetSaleId, {
        paymentMethod,
        amount: finalAmount,
        paymentTime: new Date().toISOString(),
        note: paymentNote && paymentNote.length > 0
          ? `POS | ${paymentNote}`
          : 'Captured from POS payment screen',
      });

      await fetchOrders();
      toast.success('Order created and payment captured');
      setView({ screen: 'session-detail', sessionId });
      return { ok: true };
    } catch (error: unknown) {
      reportError(error, 'pos.payment.complete');
      const message = getErrorMessage(error, 'Unable to create order/payment via backend APIs');
      toast.error(message);
      return { ok: false, errorMessage: message };
    }
  }, [fetchOrders, getOrder, getSession, scopedOutletId, token]);

  const handleCancelOrder = useCallback(async (
    orderId: string,
    payload: {
      reason: string;
      reasonCode?: string;
      voidNote?: string;
      managerPin?: string;
      managerUserId?: number;
    },
  ) => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }
    const order = ordersMap[orderId] || orders.find((item) => item.id === orderId);
    try {
      await salesApi.cancelOrder(token, orderId, {
        reason: payload.reason.trim() || null,
        reasonCode: payload.reasonCode ?? null,
        voidNote: payload.voidNote ?? null,
        managerPin: payload.managerPin ?? null,
        managerUserId: payload.managerUserId ?? null,
      });
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
    if (!canAccessCustomerReferences) {
      return (
        <POSCapabilityState
          onBack={goList}
          moduleName="POS Customers"
          state="action_disabled"
          detail="Customer lookup follows CRM read access and is not enabled for the current session."
        />
      );
    }
    return (
      <POSCustomersScreen
        onBack={goList}
        loading={customersLoading}
        error={customersError}
        errorState={customersErrorState}
        query={customerQuery}
        onQueryChange={setCustomerQuery}
        onSearch={() => void loadCustomers(customerQuery)}
        customers={customers}
      />
    );
  }

  if (view.screen === 'tables') {
    if (!canAccessOrderingTables) {
      return (
        <POSCapabilityState
          onBack={goList}
          moduleName="POS Tables"
          state="action_disabled"
          detail="Ordering-table link generation requires sales write coverage on the selected outlet."
        />
      );
    }
    return (
      <POSTablesScreen
        onBack={goList}
        loading={tablesLoading}
        error={tablesError}
        errorState={tablesErrorState}
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
        totalSessions={totalSessions}
        page={sessionsPage}
        pageSize={sessionsPageSize}
        onPageChange={setSessionsPage}
        onOpenSession={() => setView({ screen: 'open-session' })}
        onViewSession={(session) => setView({ screen: 'session-detail', sessionId: session.id })}
        onCloseSession={(session) => setView({ screen: 'close-session', sessionId: session.id })}
        onReconcile={(session) => setView({ screen: 'reconcile', sessionId: session.id })}
        onEditSession={(session) => setView({ screen: 'edit-session', sessionId: session.id })}
        onDeleteSession={(session) => handleDeleteSession(session.id)}
        onCustomers={canAccessCustomerReferences ? () => setView({ screen: 'customers' }) : undefined}
        onOutletStats={() => setView({ screen: 'outlet-stats' })}
        onTables={canAccessOrderingTables ? () => setView({ screen: 'tables' }) : undefined}
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
        ordersLoading={ordersLoading}
        onBack={goList}
        onClose={() => setView({ screen: 'close-session', sessionId: session.id })}
        onReconcile={() => setView({ screen: 'reconcile', sessionId: session.id })}
        onNewOrder={() => setView({ screen: 'order-entry', sessionId: session.id })}
        onViewOrder={handleViewOrder}
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
        currencyCode={session.currencyCode}
        onBack={() => setView({ screen: 'session-detail', sessionId: view.sessionId })}
        onCheckout={(items, promo, promoDiscount) => {
          const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
          const adjustedSubtotal = subtotal - promoDiscount;
          const currencyCode = session.currencyCode || 'USD';
          const taxAmount = roundMoney(adjustedSubtotal * 0.08, currencyCode);
          const total = roundMoney(adjustedSubtotal + taxAmount, currencyCode);
          setView({ screen: 'payment', sessionId: view.sessionId, items, promo, total, subtotal, taxAmount, promoDiscount });
        }}
      />
    );
  }

  if (view.screen === 'order-detail') {
    const order = ordersMap[view.orderId] || orders.find((item) => item.id === view.orderId);
    if ((ordersLoading || orderDetailLoadingId === view.orderId) && (!order || order.lineItems.length === 0)) {
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
        currencyCode={getOrder(view.orderId || '')?.currencyCode || getSession(view.sessionId)?.currencyCode || 'USD'}
        lineItems={view.items}
        promoCode={view.promo}
        promoDiscount={view.promoDiscount}
        subtotal={view.subtotal}
        taxAmount={view.taxAmount}
        onBack={() => setView({ screen: 'session-detail', sessionId: view.sessionId })}
        onComplete={(payload) => {
          return handlePaymentComplete(
            view.sessionId,
            view.orderId,
            view.items,
            view.promo,
            view.total,
            view.subtotal,
            view.taxAmount,
            view.promoDiscount,
            payload.paymentMethod,
            payload.note,
            payload.totalCharged,
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
        onConfirm={(payload) => {
          void handleCancelOrder(order.id, payload);
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
        onConfirm={(payload) => handleCloseSession(session.id, payload)}
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

function POSCapabilityState({
  onBack,
  moduleName,
  state,
  detail,
}: {
  onBack: () => void;
  moduleName: string;
  state: PermissionState;
  detail: string;
}) {
  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <PermissionBanner state={state} moduleName={moduleName} detail={detail} />
    </div>
  );
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
  errorState,
  query,
  onQueryChange,
  onSearch,
  customers,
}: {
  onBack: () => void;
  loading: boolean;
  error: string;
  errorState?: PermissionState | null;
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

        {errorState ? (
          <PermissionBanner
            state={errorState}
            moduleName="POS Customers"
            detail={error || 'Customer lookup is not available in the current environment.'}
          />
        ) : error ? <p className="text-xs text-destructive">{error}</p> : null}

        {errorState ? null : loading ? (
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
  errorState,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  tables,
}: {
  onBack: () => void;
  loading: boolean;
  error: string;
  errorState?: PermissionState | null;
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

  const grouped = useMemo(() => {
    const buckets = new Map<string, OrderingTableView[]>();
    for (const t of tables) {
      const code = String(t.tableCode || t.code || '?');
      // Section = leading alpha prefix or '#' for numeric-only.
      const m = /^([A-Za-z]+)/.exec(code);
      const section = m ? m[1].toUpperCase() : '#';
      if (!buckets.has(section)) buckets.set(section, []);
      buckets.get(section)!.push(t);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tables]);

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

        {errorState ? (
          <PermissionBanner
            state={errorState}
            moduleName="POS Tables"
            detail={error || 'Ordering-table links are not available in the current environment.'}
          />
        ) : error ? <p className="text-xs text-destructive">{error}</p> : null}

        {errorState ? null : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tables.length === 0 ? (
          <EmptyState
            title="No tables found"
            description="No ordering-table links were returned for the current outlet and status filter."
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(([section, sectionTables]) => (
              <div key={section} className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-semibold">Khu {section}</span>
                  <span className="text-[10px] text-muted-foreground">{sectionTables.length} bàn</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
                  {sectionTables.map((table) => {
                    const status = String(table.status || 'unknown').toLowerCase();
                    const code = String(table.tableCode || table.code || '—');
                    const name = String(table.tableName || table.name || code);
                    return (
                      <div
                        key={String(table.tableToken || table.id)}
                        className={cn(
                          'rounded-md border p-2 flex flex-col gap-1 text-xs',
                          status === 'active' ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-muted/20',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{code}</span>
                          <span className={cn('text-[9px] px-1 rounded font-medium uppercase',
                            status === 'active' ? 'bg-emerald-200 text-emerald-900' : 'bg-muted text-muted-foreground',
                          )}>
                            {status}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate">{name}</span>
                        <button
                          onClick={() => { void copyPublicPath(String(table.tableToken || '')); }}
                          className="text-[10px] text-primary underline self-start"
                        >
                          Copy URL
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
