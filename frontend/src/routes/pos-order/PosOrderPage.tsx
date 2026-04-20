import { useEffect, useState } from 'react';
import { Clock, History, ListChecks, LogOut, Plus, Power } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { ScopeOutlet } from '@/api/org-api';
import { salesApi, type SaleListItemView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';
import { useNavigate } from 'react-router-dom';
import './pos-order.css';
import { CategorySidebar } from './components/CategorySidebar';
import { MenuGrid } from './components/MenuGrid';
import { ItemOptionsDialog } from './components/ItemOptionsDialog';
import { CartPanel } from './components/CartPanel';
import { PaymentDialog, type PayMethod } from './components/PaymentDialog';
import { ReceiptPreview } from './components/ReceiptPreview';
import { KotPreview } from './components/KotPreview';
import { OutletPicker } from './components/OutletPicker';
import { OpenShiftDialog } from './components/OpenShiftDialog';
import { SubmitStatusOverlay } from './components/SubmitStatusOverlay';
import { OrdersDrawer } from './components/OrdersDrawer';
import { useOrdersFeed, type OrderScope } from './hooks/use-orders-feed';
import { useCart } from './hooks/use-pos-cart';
import { useOrderHistory, type SavedOrder } from './hooks/use-order-history';
import { usePosMenu, type PosMenuItem } from './hooks/use-pos-menu';
import { usePosSession } from './hooks/use-pos-session';
import { useSubmitOrder } from './hooks/use-submit-order';

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
  const menuQuery = usePosMenu(outletId);
  const sessionHook = usePosSession(outletId, currencyCode);
  const submit = useSubmitOrder();

  const [category, setCategory] = useState<string>('all');
  const [pickedItem, setPickedItem] = useState<PosMenuItem | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [kotOpen, setKotOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<SavedOrder | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [pendingOrderNo, setPendingOrderNo] = useState(history.nextOrderNo());
  const [drawerScope, setDrawerScope] = useState<OrderScope | null>(null);
  const qc = useQueryClient();
  const token = session?.accessToken;
  const posSessionId = sessionHook.session?.id ?? null;
  const feed = useOrdersFeed(outletId, drawerScope ?? 'today', drawerScope !== null, posSessionId);
  const todayFeed = useOrdersFeed(outletId, 'today', true, posSessionId);
  const pendingFeed = useOrdersFeed(outletId, 'pending', true, posSessionId);
  const todayCount = todayFeed.data?.length ?? history.orders.length;
  const pendingCount = pendingFeed.data?.length ?? 0;

  const [resumeTarget, setResumeTarget] = useState<SaleListItemView | null>(null);

  const cancelMutation = useMutation({
    mutationFn: (saleId: string) => salesApi.cancelOrder(token!, saleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-order-feed'] }),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Không hủy được đơn: ${msg}`);
    },
  });

  const UI_TO_BACKEND_METHOD: Record<PayMethod, string> = {
    cash: 'cash',
    card: 'card',
    qr: 'qr_code',
    voucher: 'voucher',
  };

  const resumePaymentMutation = useMutation({
    mutationFn: async (args: { saleId: string; amount: number; method: PayMethod }) =>
      salesApi.markPaymentDone(token!, args.saleId, {
        paymentMethod: UI_TO_BACKEND_METHOD[args.method],
        amount: args.amount,
        paymentTime: new Date().toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
      setResumeTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Thanh toán thất bại: ${msg}`);
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: async () => {
      if (!posSessionId) throw new Error('Chưa có ca để đóng.');
      return sessionHook.closeSession(posSessionId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/SESSION_HAS_UNPAID_ORDERS:(\d+)/);
      if (match) {
        alert(`Còn ${match[1]} đơn chưa thanh toán — vui lòng hủy hoặc thanh toán trước khi đóng ca.`);
        setDrawerScope('pending');
      } else {
        alert(`Không đóng ca được: ${msg}`);
      }
    },
  });

  const handleCancelOrder = (order: SaleListItemView) => {
    cancelMutation.mutate(String(order.id));
  };

  const handleResumeOrder = (order: SaleListItemView) => {
    setDrawerScope(null);
    setResumeTarget(order);
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

  const handleCloseShift = () => {
    if (!posSessionId) return;
    if (!window.confirm('Đóng ca hiện tại?')) return;
    closeShiftMutation.mutate();
  };

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setPendingOrderNo(history.nextOrderNo());
  }, [history]);

  useEffect(() => {
    cart.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId]);

  const menu = menuQuery.data?.menu ?? [];
  const categories = menuQuery.data?.categories ?? [];
  const modifierGroups = menuQuery.data?.modifierGroups ?? [];

  const handlePick = (item: PosMenuItem) => {
    if (!item.hasModifiers || modifierGroups.length === 0) {
      cart.addLine({ itemId: item.id, name: item.name, basePrice: item.price, toppings: [], quantity: 1 });
      return;
    }
    setPickedItem(item);
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
    });
  };

  useEffect(() => {
    if (submit.phase !== 'paid') return;
    const backend = submit.lastResult;
    const backendSubtotal = typeof backend?.subtotal === 'number' ? backend.subtotal : cart.subtotal;
    const backendDiscount = typeof backend?.discount === 'number' ? backend.discount : cart.discount;
    const backendTax = typeof backend?.taxAmount === 'number' ? backend.taxAmount : cart.vat;
    const backendTotal = typeof backend?.totalAmount === 'number' ? backend.totalAmount : cart.total;
    const order: SavedOrder = {
      orderNo: pendingOrderNo,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.phase]);

  const handleNewOrder = () => {
    setPaymentOpen(false);
    submit.reset();
    cart.reset();
  };

  const handleLogout = async () => {
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
        <button type="button" onClick={() => setDrawerScope('today')} className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md hover:bg-accent">
          <History className="w-4 h-4" /> Hôm nay ({todayCount})
        </button>
        <Button onClick={() => cart.reset()} className="h-9 pos-accent-bg hover:opacity-90">
          <Plus className="w-4 h-4 mr-1" /> Đơn mới
        </Button>
        {sessionHook.session && (
          <Button
            variant="outline"
            onClick={handleCloseShift}
            disabled={closeShiftMutation.isPending}
            className="h-9"
            title="Đóng ca"
          >
            <Power className="w-4 h-4 mr-1" /> Đóng ca
          </Button>
        )}
        <button type="button" onClick={handleLogout} className="w-9 h-9 rounded-md hover:bg-destructive/10 hover:text-destructive inline-flex items-center justify-center" title="Đăng xuất">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {menuQuery.isError && (
        <div className="px-4 py-2 text-sm bg-destructive/10 text-destructive border-b">
          Không tải được menu — kiểm tra kết nối backend.
        </div>
      )}
      {!menuQuery.isLoading && menuQuery.data && menuQuery.data.menu.length === 0 && (
        <div className="px-4 py-2 text-sm bg-warning/10 text-warning-foreground border-b">
          Catalog chưa được cấu hình cho outlet này.
        </div>
      )}
      {!menuQuery.isLoading && menuQuery.data && menuQuery.data.missingPriceCount > 0 && (
        <div className="px-4 py-2 text-sm bg-warning/10 text-warning-foreground border-b">
          {menuQuery.data.missingPriceCount} sản phẩm chưa có giá cho outlet này — cần cấu hình trong Catalog trước khi bán.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
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
          orderNo={pendingOrderNo}
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
          onApplyVoucher={cart.applyVoucher}
          loyaltyPhone={cart.loyaltyPhone}
          onLoyaltyPhoneChange={cart.setLoyaltyPhone}
          subtotal={cart.subtotal}
          discount={cart.discount}
          vat={cart.vat}
          total={cart.total}
          onCheckout={() => setPaymentOpen(true)}
          onSaveDraft={() => {
            try {
              localStorage.setItem(`pos-order-draft-${pendingOrderNo}`, JSON.stringify(cart.lines));
              cart.reset();
            } catch { /* ignore */ }
          }}
        />
      </div>

      <ItemOptionsDialog
        item={pickedItem}
        modifierGroups={modifierGroups}
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        onConfirm={cart.addLine}
      />

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={cart.total}
        orderNo={pendingOrderNo}
        onConfirm={doSubmit}
        onPrintReceipt={() => { setPaymentOpen(false); setTimeout(() => setReceiptOpen(true), 120); }}
        onPrintKot={() => { setPaymentOpen(false); setTimeout(() => setKotOpen(true), 120); }}
        onNewOrder={handleNewOrder}
      />

      <ReceiptPreview open={receiptOpen} onOpenChange={setReceiptOpen} order={lastOrder} />
      <KotPreview open={kotOpen} onOpenChange={setKotOpen} order={lastOrder} />

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
        isLoading={feed.isLoading}
        error={feed.error}
        orders={feed.data ?? []}
        onRefresh={() => feed.refetch()}
        onCancel={handleCancelOrder}
        onResume={handleResumeOrder}
        hasSession={!!posSessionId}
        cancellingId={cancelMutation.isPending ? String(cancelMutation.variables ?? '') : null}
      />

      <PaymentDialog
        open={resumeTarget !== null}
        onOpenChange={(v) => { if (!v) setResumeTarget(null); }}
        total={Number(resumeTarget?.totalAmount ?? 0)}
        orderNo={resumeTarget ? String(resumeTarget.id).slice(-6) : ''}
        onConfirm={handleResumeConfirm}
        onPrintReceipt={() => setResumeTarget(null)}
        onPrintKot={() => setResumeTarget(null)}
        onNewOrder={() => setResumeTarget(null)}
      />

      <OpenShiftDialog
        open={sessionHook.needsOpenSession}
        outletName={outletName}
        isSubmitting={sessionHook.openSessionState.isPending}
        error={sessionHook.openSessionState.error instanceof Error ? sessionHook.openSessionState.error.message : null}
        onSubmit={async (args) => sessionHook.openSession(args)}
      />
    </div>
  );
}
