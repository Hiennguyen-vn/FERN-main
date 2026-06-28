import { useEffect, useState } from 'react';
import { ClipboardList, Clock, History, ListChecks, LogOut, Plus, Power, QrCode } from 'lucide-react';
import { QrQueueView } from './components/QrQueueView';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { ScopeOutlet } from '@/api/org-api';
import { salesApi, type SaleListItemView } from '@/api/sales-api';
import { productApi } from '@/api/product-api';
import { useAuth } from '@/auth/use-auth';
import { useNavigate } from 'react-router-dom';
import './pos-order.css';
import { CategorySidebar } from './components/CategorySidebar';
import { MenuGrid } from './components/MenuGrid';
import { ItemOptionsDialog } from './components/ItemOptionsDialog';
import { CartPanel } from './components/CartPanel';
import { PaymentDialog, type PayMethod } from './components/PaymentDialog';
import { OrderPrintPreview } from './components/OrderPrintPreview';
import { OutletPicker } from './components/OutletPicker';
import { OpenShiftDialog } from './components/OpenShiftDialog';
import { CloseShiftDialog } from './components/CloseShiftDialog';
import { SubmitStatusOverlay } from './components/SubmitStatusOverlay';
import { OrdersDrawer } from './components/OrdersDrawer';
import type { OrderScope } from './hooks/use-orders-feed';
import { usePosOrderFeeds } from './hooks/use-pos-order-feeds';
import { useCart } from './hooks/use-pos-cart';
import { useOrderHistory, type SavedOrder } from './hooks/use-order-history';
import { useDraftOrders } from './hooks/use-draft-orders';
import { usePosMenu, type PosMenuItem } from './hooks/use-pos-menu';
import { DraftPickerDialog } from './components/DraftPickerDialog';
import { usePosSession } from './hooks/use-pos-session';
import { useShiftCloseSummary } from './hooks/use-shift-close-summary';
import { parseUnpaidOrdersError } from './utils/shift-close';
import { PendingSubmitBanner } from './components/PendingSubmitBanner';
import { useSubmitOrder, discardPendingSnapshot, listRecoverablePending, type PendingSnapshot } from './hooks/use-submit-order';
import { lookupPromotionVoucher } from './utils/promo-voucher';
import { useQrOrders } from './hooks/use-qr-orders';
import { isWaitingCustomerOrder } from '@/components/pos/customer-order-queue';
import { UI_TO_BACKEND_PAYMENT_METHOD } from './utils/payment-methods';

interface Props {
  outletId: string;
  outletName: string;
  currencyCode: string;
  outlets: ScopeOutlet[];
  setOutletId: (id: string) => void;
}

export default function PosOrderPage({ outletId, outletName, currencyCode, outlets, setOutletId }: Props) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const cart = useCart();
  const history = useOrderHistory();
  const draftOrders = useDraftOrders();
  const menuQuery = usePosMenu(outletId);
  const sessionHook = usePosSession(outletId, currencyCode);
  const submit = useSubmitOrder();

  const [category, setCategory] = useState<string>('all');
  const [pickedItem, setPickedItem] = useState<PosMenuItem | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<SavedOrder | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [recoverablePending, setRecoverablePending] = useState<PendingSnapshot[]>([]);
  const [isResumingPending, setIsResumingPending] = useState(false);
  const [drawerScope, setDrawerScope] = useState<OrderScope | null>(null);
  const [view, setView] = useState<'menu' | 'qr-queue'>('menu');
  const [draftPickerOpen, setDraftPickerOpen] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [closeShiftError, setCloseShiftError] = useState<string | null>(null);
  const qc = useQueryClient();
  const token = session?.accessToken;
  const posSessionId = sessionHook.session?.id ?? null;
  const orderFeeds = usePosOrderFeeds({ outletId, posSessionId, drawerScope, closeShiftOpen });
  const shiftSummary = useShiftCloseSummary(outletId, posSessionId, sessionHook.session, closeShiftOpen);
  const openingCash = shiftSummary.openingCash;
  const qrOrdersQuery = useQrOrders(outletId);
  const customerWaitingCount = (qrOrdersQuery.data ?? []).filter(isWaitingCustomerOrder).length;
  const todayCount = orderFeeds.todayCount;
  const pendingCount = orderFeeds.pendingCount;
  const displayOrderNo = String(todayCount + 1).padStart(4, '0');
  const isPaymentProcessing =
    submit.phase === 'creating' ||
    submit.phase === 'created' ||
    submit.phase === 'approving' ||
    submit.phase === 'approved' ||
    submit.phase === 'paying';

  const [resumeTarget, setResumeTarget] = useState<SaleListItemView | null>(null);
  const [resumePaid, setResumePaid] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: (saleId: string) => salesApi.cancelOrder(token!, saleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-order-feed'] }),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Không hủy được đơn: ${msg}`);
    },
  });

  const resumePaymentMutation = useMutation({
    mutationFn: async (args: { saleId: string; amount: number; method: PayMethod }) =>
      salesApi.markPaymentDone(token!, args.saleId, {
        paymentMethod: UI_TO_BACKEND_PAYMENT_METHOD[args.method],
        amount: args.amount,
        paymentTime: new Date().toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
      setResumePaid(true);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Thanh toán thất bại: ${msg}`);
    },
  });

  const handleCloseShift = () => {
    if (!posSessionId) return;
    setCloseShiftError(null);
    void shiftSummary.refetch();
    setCloseShiftOpen(true);
  };

  const handleCloseShiftSubmit = async (args: {
    lines: Array<{ paymentMethod: string; actualAmount: number }>;
    note?: string;
  }) => {
    if (!posSessionId) throw new Error('Chưa có ca để đóng.');
    setCloseShiftError(null);
    try {
      await sessionHook.reconcileSession({
        sessionId: posSessionId,
        lines: args.lines,
        note: args.note,
      });
      cart.reset();
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const unpaidCount = parseUnpaidOrdersError(msg);
      if (unpaidCount != null) {
        setCloseShiftError(`Còn ${unpaidCount} đơn chưa thanh toán — vui lòng xử lý trước khi đóng ca.`);
        setDrawerScope('pending');
        throw err;
      }
      setCloseShiftError(msg);
      throw err;
    }
  };

  const handleCancelOrder = (order: SaleListItemView) => {
    cancelMutation.mutate(String(order.id));
  };

  const handleResumeOrder = (order: SaleListItemView) => {
    setDrawerScope(null);
    setResumePaid(false);
    setResumeTarget(order);
  };

  const dismissResumePayment = () => {
    setResumeTarget(null);
    setResumePaid(false);
  };

  const handleResumeConfirm = (method: PayMethod) => {
    if (!resumeTarget) return;
    const amount = Number(resumeTarget.totalAmount ?? 0);
    resumePaymentMutation.mutate({
      saleId: String(resumeTarget.id),
      amount,
      method,
    });
  };

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setRecoverablePending(listRecoverablePending(outletId));
  }, [outletId, submit.phase]);

  const buildSubmitArgs = () => ({
    outletId,
    currencyCode,
    posSessionId: sessionHook.session?.id ?? null,
    orderType: cart.orderType,
    customerName: cart.customerName || undefined,
    lines: cart.lines,
    lineUnitPrice: cart.lineTotal,
    subtotal: cart.subtotal,
    discount: cart.discount,
    vat: cart.vat,
    previewTotal: cart.total,
    method: 'cash' as PayMethod,
    promotionId: cart.voucher?.promotionId,
  });

  const handleApplyVoucher = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      cart.setVoucherApplied(null);
      return;
    }
    if (!token) {
      cart.applyVoucher(code);
      return;
    }
    try {
      const result = await lookupPromotionVoucher(token, outletId, trimmed, cart.subtotal);
      if ('error' in result) {
        cart.setVoucherApplied(null, result.error);
        return;
      }
      cart.setVoucherApplied(result.voucher);
    } catch {
      cart.applyVoucher(code);
    }
  };

  const handleResumePending = async (snapshot: PendingSnapshot) => {
    setIsResumingPending(true);
    cart.restore({
      lines: snapshot.lines,
      orderType: snapshot.orderType,
      customerName: snapshot.customerName,
    });
    const args = {
      ...buildSubmitArgs(),
      method: snapshot.method,
      promotionId: snapshot.promotionId,
    };
    try {
      await submit.continuePending(snapshot, args);
    } finally {
      setIsResumingPending(false);
      setRecoverablePending(listRecoverablePending(outletId));
    }
  };

  const handleDiscardPending = (snapshot: PendingSnapshot) => {
    discardPendingSnapshot(snapshot.idempotencyKey);
    setRecoverablePending(listRecoverablePending(outletId));
    if (submit.idempotencyKey === snapshot.idempotencyKey) {
      submit.reset();
    }
  };

  useEffect(() => {
    cart.reset();
    submit.reset();
    setCategory('all');
    setPickedItem(null);
    setOptionsOpen(false);
    setPaymentOpen(false);
    setPrintOpen(false);
    setLastOrder(null);
    setDrawerScope(null);
    setView('menu');
    setDraftPickerOpen(false);
    setCloseShiftOpen(false);
    setCloseShiftError(null);
    setResumeTarget(null);
    setResumePaid(false);
    setRecoverablePending(listRecoverablePending(outletId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  const menu = menuQuery.data?.menu ?? [];
  const categories = menuQuery.data?.categories ?? [];

  const handlePick = async (item: PosMenuItem) => {
    if (!item.isAvailable) return;
    const modifierGroups = item.modifierGroups.length > 0
      ? item.modifierGroups
      : await qc.fetchQuery({
          queryKey: ['pos-order-modifier-groups', item.id],
          queryFn: () => productApi.modifierGroupsForProduct(token!, item.id),
          staleTime: 10 * 60_000,
          gcTime: 30 * 60_000,
        }).catch((): PosMenuItem['modifierGroups'] => []);

    if (modifierGroups.length === 0) {
      cart.addLine({ itemId: item.id, name: item.name, basePrice: item.price, toppings: [], quantity: 1 });
      return;
    }
    setPickedItem({ ...item, hasModifiers: true, modifierGroups });
    setOptionsOpen(true);
  };

  const doSubmit = (method: PayMethod) => {
    const zeroLine = cart.lines.find((l) => l.basePrice <= 0);
    if (zeroLine) {
      alert(`Món "${zeroLine.name}" chưa có giá — không thể tạo đơn.`);
      return;
    }
    submit.submit({
      outletId,
      currencyCode,
      posSessionId: sessionHook.session?.id ?? null,
      orderType: cart.orderType,
      customerName: cart.customerName || undefined,
      lines: cart.lines,
      lineUnitPrice: cart.lineTotal,
      subtotal: cart.subtotal,
      discount: cart.discount,
      vat: cart.vat,
      previewTotal: cart.total,
      method,
      promotionId: cart.voucher?.promotionId,
    });
  };

  useEffect(() => {
    if (submit.phase !== 'paid' || !posSessionId) return;
    const backend = submit.lastResult;
    const backendSubtotal = typeof backend?.subtotal === 'number' ? backend.subtotal : cart.subtotal;
    const backendDiscount = typeof backend?.discount === 'number' ? backend.discount : cart.discount;
    const backendTax = typeof backend?.taxAmount === 'number' ? backend.taxAmount : cart.vat;
    const backendTotal = typeof backend?.totalAmount === 'number' ? backend.totalAmount : cart.total;
    const order: SavedOrder = {
      orderNo: displayOrderNo,
      createdAt: new Date().toISOString(),
      orderType: cart.orderType,
      customerName: cart.customerName,
      lines: cart.lines,
      subtotal: backendSubtotal,
      discount: backendDiscount,
      vat: backendTax,
      total: backendTotal,
      paymentMethod: (backend?.payment?.paymentMethod as string) ?? 'cash',
    };
    history.save(order);
    setLastOrder(order);
    void qc.invalidateQueries({ queryKey: ['pos-order-menu', outletId] });
    void (async () => {
      await qc.invalidateQueries({ queryKey: ['pos-order-feed', 'today', outletId, posSessionId] });
      await qc.invalidateQueries({ queryKey: ['pos-order-feed', 'pending', outletId, posSessionId] });
      await orderFeeds.refetchAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.phase, posSessionId, outletId]);

  useEffect(() => {
    if (!posSessionId) return;
    void orderFeeds.refetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posSessionId]);

  const finalizePaidOrder = () => {
    setPaymentOpen(false);
    submit.reset();
    cart.reset();
  };

  const handleNewOrder = () => {
    finalizePaidOrder();
  };

  const handlePrintOrder = () => {
    finalizePaidOrder();
    setPrintOpen(true);
  };

  const handleLogout = async () => {
    if (posSessionId) {
      setCloseShiftError(null);
      setCloseShiftOpen(true);
      return;
    }
    await logout();
    navigate('/login', { replace: true });
  };

  const handleLogoutAfterClose = async () => {
    setCloseShiftOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const timeStr = clock.toLocaleTimeString('vi-VN', { hour12: false });
  const cashierName = session?.user?.fullName ?? session?.user?.username ?? '—';
  const initials = cashierName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="pos-order-root h-screen flex flex-col bg-[hsl(var(--pos-bg))] text-foreground">
      <header className="h-14 shrink-0 bg-white border-b flex items-center px-4 gap-4">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-7 h-7 rounded-full bg-muted inline-flex items-center justify-center text-xs font-bold">{initials}</div>
          <div>
            <span className="font-medium">{cashierName}</span>
            {sessionHook.session?.sessionCode && (
              <span className="text-muted-foreground"> · {sessionHook.session.sessionCode}</span>
            )}
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="w-4 h-4 pos-accent-text" />
          <span className="font-mono">{timeStr}</span>
        </div>
        <div className="flex-1" />
        <OutletPicker outletId={outletId} outlets={outlets} onChange={setOutletId} />
        <button type="button" onClick={() => setDrawerScope('pending')} className="relative inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md hover:bg-accent">
          <ListChecks className="w-4 h-4" /> Đang chờ
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold pos-accent-bg">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setView((v) => (v === 'qr-queue' ? 'menu' : 'qr-queue'))}
          className={`relative inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md ${
            view === 'qr-queue' ? 'pos-accent-soft-bg pos-accent-text font-semibold' : 'hover:bg-accent'
          }`}
        >
          <QrCode className="w-4 h-4" /> Đơn khách QR
          {customerWaitingCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold bg-warning text-warning-foreground">
              {customerWaitingCount}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setDrawerScope('today')} className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md hover:bg-accent">
          <History className="w-4 h-4" /> Hôm nay ({todayCount})
        </button>
        <div className="flex items-center gap-1">
          <Button onClick={() => { cart.reset(); setView('menu'); }} className="h-9 pos-accent-bg hover:opacity-90 rounded-r-none pr-3">
            <Plus className="w-4 h-4 mr-1" /> Đơn mới
          </Button>
          <button
            type="button"
            onClick={() => setDraftPickerOpen(true)}
            className="relative h-9 px-2 pos-accent-bg hover:opacity-90 rounded-l-none border-l border-white/30 inline-flex items-center justify-center"
            title="Đơn lưu tạm"
          >
            <ClipboardList className="w-4 h-4 text-white" />
            {draftOrders.drafts.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 inline-flex items-center justify-center rounded-full text-[9px] font-bold bg-white pos-accent-text">
                {draftOrders.drafts.length}
              </span>
            )}
          </button>
        </div>
        {sessionHook.session && (
          <Button
            variant="outline"
            onClick={handleCloseShift}
            disabled={sessionHook.reconcileSessionState.isPending}
            className="h-9"
            title="Đóng ca"
          >
            <Power className="w-4 h-4 mr-1" /> Đóng ca
          </Button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="w-9 h-9 rounded-md hover:bg-destructive/10 hover:text-destructive inline-flex items-center justify-center"
          title={posSessionId ? 'Đóng ca trước khi đăng xuất' : 'Đăng xuất'}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {recoverablePending[0] && submit.phase === 'idle' && (
        <PendingSubmitBanner
          snapshot={recoverablePending[0]}
          onResume={() => void handleResumePending(recoverablePending[0])}
          onDiscard={() => handleDiscardPending(recoverablePending[0])}
          isResuming={isResumingPending}
        />
      )}

      <div className="flex-1 flex min-h-0">
        {view === 'qr-queue' ? (
          <QrQueueView
            outletId={outletId}
            outletName={outletName}
            menu={menu}
            onRequestPayment={(order) => setResumeTarget(order)}
            ordersQuery={qrOrdersQuery}
          />
        ) : (
          <>
        <CategorySidebar
          active={category}
          categories={categories}
          totalCount={menu.length}
          onChange={setCategory}
          outletName={outletName}
        />
        <MenuGrid
          category={category}
          items={menu}
          onPick={handlePick}
          isLoading={menuQuery.isLoading}
        />
        <CartPanel
          orderNo={displayOrderNo}
          orderType={cart.orderType}
          onOrderTypeChange={cart.setOrderType}
          customerName={cart.customerName}
          onCustomerNameChange={cart.setCustomerName}
          lines={cart.lines}
          lineTotal={cart.lineTotal}
          onQtyChange={cart.updateQty}
          onRemove={cart.removeLine}
          onClear={cart.reset}
          voucher={cart.voucher}
          voucherError={cart.voucherError}
          onApplyVoucher={(code) => { void handleApplyVoucher(code); }}
          loyaltyPhone={cart.loyaltyPhone}
          onLoyaltyPhoneChange={cart.setLoyaltyPhone}
          subtotal={cart.subtotal}
          discount={cart.discount}
          vat={cart.vat}
          total={cart.total}
          onCheckout={() => setPaymentOpen(true)}
          onSaveDraft={() => {
            if (cart.lines.length === 0) return;
            draftOrders.saveDraft({
              orderNo: displayOrderNo,
              orderType: cart.orderType,
              customerName: cart.customerName,
              lines: cart.lines,
            });
            cart.reset();
          }}
        />
          </>
        )}
      </div>

      <ItemOptionsDialog
        item={pickedItem}
        modifierGroups={pickedItem?.modifierGroups ?? []}
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        onConfirm={cart.addLine}
      />

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={(open) => {
          if (!open && submit.phase === 'paid') {
            finalizePaidOrder();
            return;
          }
          setPaymentOpen(open);
        }}
        total={lastOrder?.total ?? cart.total}
        orderNo={lastOrder?.orderNo ?? displayOrderNo}
        onConfirm={doSubmit}
        onPrintOrder={handlePrintOrder}
        onNewOrder={handleNewOrder}
        isPaid={submit.phase === 'paid' && lastOrder !== null}
        isProcessing={isPaymentProcessing}
      />

      <OrderPrintPreview open={printOpen} onOpenChange={setPrintOpen} order={lastOrder} />

      <SubmitStatusOverlay
        phase={submit.phase}
        error={submit.error}
        onRetryCreate={submit.retryCreate}
        onRetryApprove={submit.retryApprove}
        onRetryPayment={submit.retryPayment}
        onDismiss={submit.reset}
      />

      <OrdersDrawer
        open={drawerScope !== null}
        onOpenChange={(v) => { if (!v) setDrawerScope(null); }}
        scope={drawerScope ?? 'today'}
        isLoading={orderFeeds.drawerLoading}
        error={orderFeeds.drawerError}
        orders={orderFeeds.drawerOrders}
        onRefresh={() => orderFeeds.refetchDrawer()}
        onCancel={handleCancelOrder}
        onResume={handleResumeOrder}
        hasSession={!!posSessionId}
        cancellingId={cancelMutation.isPending ? String(cancelMutation.variables ?? '') : null}
      />

      <PaymentDialog
        open={resumeTarget !== null}
        onOpenChange={(v) => { if (!v) dismissResumePayment(); }}
        total={Number(resumeTarget?.totalAmount ?? 0)}
        orderNo={resumeTarget ? String(resumeTarget.id).slice(-6) : ''}
        onConfirm={handleResumeConfirm}
        onPrintOrder={dismissResumePayment}
        onNewOrder={dismissResumePayment}
        isPaid={resumePaid}
        isProcessing={resumePaymentMutation.isPending}
      />

      <DraftPickerDialog
        open={draftPickerOpen}
        onOpenChange={setDraftPickerOpen}
        drafts={draftOrders.drafts}
        onRestore={(draft) => {
          cart.reset();
          draft.lines.forEach((l) => cart.addLine({ ...l }));
          cart.setOrderType(draft.orderType);
          cart.setCustomerName(draft.customerName);
          draftOrders.deleteDraft(draft.draftId);
          setView('menu');
        }}
        onDelete={draftOrders.deleteDraft}
        onUpdate={draftOrders.updateDraft}
      />

      <OpenShiftDialog
        open={sessionHook.needsOpenSession && !closeShiftOpen}
        outletName={outletName}
        isSubmitting={sessionHook.openSessionState.isPending}
        error={sessionHook.openSessionState.error instanceof Error ? sessionHook.openSessionState.error.message : null}
        onSubmit={async (args) => sessionHook.openSession(args)}
      />

      {sessionHook.session && (
        <CloseShiftDialog
          open={closeShiftOpen}
          onOpenChange={(open) => {
            setCloseShiftOpen(open);
            if (!open) setCloseShiftError(null);
          }}
          outletName={outletName}
          session={sessionHook.session}
          openingCash={openingCash}
          summary={shiftSummary.summary}
          summaryLoading={shiftSummary.isLoading}
          pendingCount={pendingCount}
          currencyCode={currencyCode}
          isSubmitting={sessionHook.reconcileSessionState.isPending}
          error={closeShiftError}
          onSubmit={handleCloseShiftSubmit}
          onLogout={handleLogoutAfterClose}
        />
      )}
    </div>
  );
}
