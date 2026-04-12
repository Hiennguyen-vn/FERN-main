import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/use-auth';
import { hasSalesOrderQueueAccess } from '@/auth/authorization';
import {
  productApi,
  salesApi,
  type PosSessionView,
  type ProductView,
  type SaleDetailView,
  type SaleListItemView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { EmptyState, PermissionBanner } from '@/components/shell/PermissionStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { normalizeNumericId } from '@/constants/pos';
import type { PaymentMethod, SaleOrder } from '@/types/pos';
import { PaymentCapture } from '@/components/pos/PaymentCapture';
import { SaleOrderDetail } from '@/components/pos/SaleOrderDetail';
import { cn } from '@/lib/utils';
import { formatPosCurrency, mapSaleToUi } from '@/components/pos/sale-order-utils';

interface CustomerOrdersWorkspaceProps {
  onBack?: () => void;
  surfaceLabel?: string;
}

type QueueFilter = 'all' | 'waiting' | 'approved' | 'paid' | 'cancelled';

function getQueueFilter(order: SaleOrder): QueueFilter {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.paymentStatus === 'paid' || order.status === 'completed') return 'paid';
  if (order.backendStatus === 'order_approved') return 'approved';
  return 'waiting';
}

function shortToken(value: string | undefined) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function statusBadgeClass(order: SaleOrder) {
  const filter = getQueueFilter(order);
  switch (filter) {
    case 'paid':
      return 'bg-success/10 text-success';
    case 'approved':
      return 'bg-info/10 text-info';
    case 'cancelled':
      return 'bg-destructive/10 text-destructive';
    default:
      return 'bg-warning/10 text-warning';
  }
}

export function CustomerOrdersWorkspace({
  onBack,
  surfaceLabel = 'Customer Orders',
}: CustomerOrdersWorkspaceProps) {
  const { session } = useAuth();
  const { token, scope, user } = useShellRuntime();
  const [orders, setOrders] = useState<SaleListItemView[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<SaleDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [sessionCodeById, setSessionCodeById] = useState<Map<string, string>>(new Map());
  const [productNameById, setProductNameById] = useState<Map<string, string>>(new Map());
  const [paymentTarget, setPaymentTarget] = useState<SaleOrder | null>(null);
  const [approveBusyId, setApproveBusyId] = useState('');
  const [paymentBusyId, setPaymentBusyId] = useState('');

  const scopedOutletId = normalizeNumericId(scope.outletId);
  const hasQueueAccess = hasSalesOrderQueueAccess(session);

  const loadOrders = useCallback(async () => {
    if (!token || !scopedOutletId) {
      setOrders([]);
      setOrdersError('');
      return;
    }

    setOrdersLoading(true);
    setOrdersError('');
    try {
      const [ordersPage, sessionsPage] = await Promise.all([
        salesApi.orders(token, {
          outletId: scopedOutletId,
          publicOrderOnly: true,
          limit: 100,
          offset: 0,
          sortBy: 'createdAt',
          sortDir: 'desc',
        }),
        salesApi.posSessions(token, {
          outletId: scopedOutletId,
          limit: 100,
          offset: 0,
        }),
      ]);

      setOrders(ordersPage.items || []);
      setSessionCodeById(new Map(
        (sessionsPage.items || []).map((session: PosSessionView) => [
          String(session.id),
          String(session.sessionCode || session.id || '—'),
        ]),
      ));
    } catch (error: unknown) {
      console.error('Customer order queue load failed:', error);
      setOrders([]);
      setOrdersError(getErrorMessage(error, 'Unable to load customer orders'));
    } finally {
      setOrdersLoading(false);
    }
  }, [scopedOutletId, token]);

  useEffect(() => {
    if (!token) {
      setProductNameById(new Map());
      return;
    }
    const loadProducts = async () => {
      try {
        const products = await productApi.products(token);
        setProductNameById(new Map(
          products.map((product: ProductView) => [String(product.id), String(product.name || `Product ${product.id}`)]),
        ));
      } catch (error) {
        console.error('Customer order queue product load failed:', error);
      }
    };
    void loadProducts();
  }, [token]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedDetail(null);
      setDetailError('');
      return;
    }
    if (!token) {
      return;
    }
    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const detail = await salesApi.orderDetail(token, selectedOrderId);
        setSelectedDetail(detail);
      } catch (error: unknown) {
        console.error('Customer order detail load failed:', error);
        setSelectedDetail(null);
        setDetailError(getErrorMessage(error, 'Unable to load customer order detail'));
      } finally {
        setDetailLoading(false);
      }
    };
    void loadDetail();
  }, [selectedOrderId, token]);

  useEffect(() => {
    if (orders.length === 0) {
      setSelectedOrderId('');
      return;
    }
    if (!orders.some((order) => String(order.id) === selectedOrderId)) {
      setSelectedOrderId(String(orders[0].id));
    }
  }, [orders, selectedOrderId]);

  const mappedOrders = useMemo(
    () => orders.map((order) => mapSaleToUi(order, null, scope.outletName || 'Selected outlet', user.displayName, sessionCodeById, productNameById)),
    [orders, productNameById, scope.outletName, sessionCodeById, user.displayName],
  );

  const filteredOrders = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();
    return mappedOrders.filter((order) => {
      if (queueFilter !== 'all' && getQueueFilter(order) !== queueFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        order.orderNumber,
        order.publicOrderToken,
        order.tableName,
        order.tableNumber,
        order.note,
        order.createdBy,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [mappedOrders, queueFilter, search]);

  const selectedOrderBase = useMemo(
    () => orders.find((order) => String(order.id) === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  const selectedOrder = useMemo(() => {
    if (!selectedOrderBase) {
      return null;
    }
    return mapSaleToUi(
      selectedOrderBase,
      selectedDetail,
      scope.outletName || 'Selected outlet',
      user.displayName,
      sessionCodeById,
      productNameById,
    );
  }, [productNameById, scope.outletName, selectedDetail, selectedOrderBase, sessionCodeById, user.displayName]);

  const handleApprove = useCallback(async (order: SaleOrder) => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }
    setApproveBusyId(order.id);
    try {
      await salesApi.approveOrder(token, order.id);
      toast.success('Customer order approved');
      await loadOrders();
      const refreshed = await salesApi.orderDetail(token, order.id);
      setSelectedDetail(refreshed);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to approve customer order'));
    } finally {
      setApproveBusyId('');
    }
  }, [loadOrders, token]);

  const openPaymentCapture = useCallback(async (order: SaleOrder) => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }

    try {
      const detail = await salesApi.orderDetail(token, order.id);
      const baseSale = orders.find((candidate) => String(candidate.id) === order.id);
      setSelectedOrderId(order.id);
      setSelectedDetail(detail);
      setPaymentTarget(
        mapSaleToUi(
          baseSale ?? {
            id: order.id,
            outletId: scopedOutletId,
            posSessionId: order.sessionId || null,
            publicOrderToken: order.publicOrderToken || null,
            status: detail.status,
            paymentStatus: detail.paymentStatus,
            orderType: detail.orderType,
            orderingTableCode: detail.orderingTableCode,
            orderingTableName: detail.orderingTableName,
            currencyCode: detail.currencyCode,
            subtotal: detail.subtotal,
            discount: detail.discount,
            taxAmount: detail.taxAmount,
            totalAmount: detail.totalAmount,
            note: detail.note,
            createdAt: detail.createdAt,
            items: detail.items,
            payment: detail.payment,
          },
          detail,
          scope.outletName || 'Selected outlet',
          user.displayName,
          sessionCodeById,
          productNameById,
        ),
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to load order payment detail'));
    }
  }, [orders, productNameById, scopedOutletId, scope.outletName, sessionCodeById, token, user.displayName]);

  const handleCompletePayment = useCallback(async (paymentMethod: PaymentMethod) => {
    if (!token || !paymentTarget) {
      return { ok: false, errorMessage: 'Payment target is missing' };
    }

    setPaymentBusyId(paymentTarget.id);
    try {
      await salesApi.markPaymentDone(token, paymentTarget.id, {
        paymentMethod,
        amount: paymentTarget.total,
        paymentTime: new Date().toISOString(),
        note: 'Captured from customer-order queue',
      });
      toast.success('Customer order payment captured');
      await loadOrders();
      const refreshed = await salesApi.orderDetail(token, paymentTarget.id);
      setSelectedDetail(refreshed);
      setPaymentTarget(null);
      return { ok: true };
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to capture payment');
      toast.error(message);
      return { ok: false, errorMessage: message };
    } finally {
      setPaymentBusyId('');
    }
  }, [loadOrders, paymentTarget, token]);

  if (!hasQueueAccess) {
    return (
      <div className="p-6">
        <PermissionBanner
          state="hidden"
          moduleName="Customer Orders"
          detail="This queue requires sales write access so staff can approve and complete payment for customer-submitted orders."
        />
      </div>
    );
  }

  if (!scopedOutletId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="Select an outlet scope"
          description="Customer orders are processed outlet by outlet. Pick an outlet scope in the shell to open this queue."
        />
      </div>
    );
  }

  if (paymentTarget) {
    return (
      <PaymentCapture
        orderTotal={paymentTarget.total}
        currencyCode={paymentTarget.currencyCode}
        lineItems={paymentTarget.lineItems}
        promoCode={paymentTarget.promotionCode || null}
        promoDiscount={paymentTarget.promotionDiscount || 0}
        subtotal={paymentTarget.subtotal}
        taxAmount={paymentTarget.taxAmount}
        onBack={() => setPaymentTarget(null)}
        onComplete={handleCompletePayment}
      />
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{surfaceLabel}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review customer-submitted table orders, approve them into the live POS flow, then capture payment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onBack}>
              <ArrowLeft className="h-3 w-3" /> Back
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => void loadOrders()} disabled={ordersLoading}>
            {ordersLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'All', value: mappedOrders.length, filter: 'all' as const },
          { label: 'Waiting Approval', value: mappedOrders.filter((order) => getQueueFilter(order) === 'waiting').length, filter: 'waiting' as const },
          { label: 'Approved', value: mappedOrders.filter((order) => getQueueFilter(order) === 'approved').length, filter: 'approved' as const },
          { label: 'Paid', value: mappedOrders.filter((order) => getQueueFilter(order) === 'paid').length, filter: 'paid' as const },
        ]).map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setQueueFilter(item.filter)}
            className={cn(
              'surface-elevated p-3 text-left transition-colors',
              queueFilter === item.filter ? 'ring-1 ring-primary/35' : '',
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-xl font-semibold text-foreground mt-1">{item.value}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="surface-elevated p-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              className="h-8 max-w-sm text-xs"
              placeholder="Search by order, token, table, or note"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex items-center gap-1.5">
              {(['all', 'waiting', 'approved', 'paid', 'cancelled'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-[11px] capitalize transition-colors',
                    queueFilter === filter
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground border-border hover:bg-accent',
                  )}
                  onClick={() => setQueueFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {ordersError ? <p className="text-xs text-destructive">{ordersError}</p> : null}

          {ordersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <EmptyState
              title="No customer orders in view"
              description="No public customer-submitted orders matched the current outlet scope and filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Order', 'Table', 'Created', 'Run State', 'Payment', 'Total', 'Action'].map((header) => (
                      <th key={header} className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const queueState = getQueueFilter(order);
                    return (
                      <tr
                        key={order.id}
                        className={cn(
                          'border-b last:border-0 transition-colors hover:bg-muted/20 cursor-pointer',
                          selectedOrderId === order.id ? 'bg-muted/20' : '',
                        )}
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{order.orderNumber}</div>
                          <div className="text-[11px] text-muted-foreground">{shortToken(order.publicOrderToken)}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {order.tableName || order.tableNumber || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(order.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize', statusBadgeClass(order))}>
                            {queueState.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{order.paymentStatus}</td>
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{formatPosCurrency(order.total, order.currencyCode)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {queueState === 'waiting' ? (
                              <Button
                                size="sm"
                                className="h-7 text-[10px]"
                                disabled={approveBusyId === order.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleApprove(order);
                                }}
                              >
                                {approveBusyId === order.id ? 'Approving…' : 'Approve'}
                              </Button>
                            ) : null}
                            {queueState === 'approved' ? (
                              <Button
                                size="sm"
                                className="h-7 text-[10px]"
                                disabled={paymentBusyId === order.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void openPaymentCapture(order);
                                }}
                              >
                                Capture payment
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="surface-elevated min-h-[320px]">
          {!selectedOrderId ? (
            <EmptyState
              title="Select a customer order"
              description="Pick an order from the queue to inspect line items, approval state, and payment readiness."
            />
          ) : detailLoading && !selectedOrder ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : detailError ? (
            <div className="p-6 text-sm text-destructive">{detailError}</div>
          ) : selectedOrder ? (
            <SaleOrderDetail
              order={selectedOrder}
              onBack={() => setSelectedOrderId('')}
              onApprove={getQueueFilter(selectedOrder) === 'waiting' ? () => void handleApprove(selectedOrder) : undefined}
              onPay={getQueueFilter(selectedOrder) === 'approved' ? () => void openPaymentCapture(selectedOrder) : undefined}
              approvePending={approveBusyId === selectedOrder.id}
              paymentPending={paymentBusyId === selectedOrder.id}
            />
          ) : (
            <EmptyState
              title="Order not found"
              description="The selected order is no longer available in the current queue result."
            />
          )}
        </div>
      </div>
    </div>
  );
}
