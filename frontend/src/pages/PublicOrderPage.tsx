import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CircleAlert,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { salesApi, type PublicOrderReceiptView } from '@/api/fern-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  PUBLIC_ORDER_POLL_INTERVAL_MS,
  asPublicApiError,
  computePublicOrderCartSummary,
  createEmptyPublicOrderCartDraft,
  formatPublicLabel,
  groupPublicMenuByCategory,
  isPublicOrderNotFoundError,
  isPublicOrderUnavailableError,
  publicOrderCartStorageKey,
  publicOrderLastOrderStorageKey,
  sanitizePublicOrderCartDraft,
  shortPublicOrderRef,
  toCreatePublicOrderPayload,
  toPublicOrderErrorMessage,
  type PublicOrderCartDraft,
  type PublicOrderCartLine,
} from '@/lib/public-order';
import { cn } from '@/lib/utils';
import { PublicMenuBrowser } from './public-order/PublicMenuBrowser';
import { PublicOrderCartBar, PublicOrderCartPanel } from './public-order/PublicOrderCartPanel';
import { PublicOrderHeader } from './public-order/PublicOrderHeader';
import {
  formatPublicCurrency,
  formatPublicDateTime,
  productDisplayName,
} from './public-order/public-order-format';
import { StatusHero } from './public-order/StatusHero';
import { derivePublicOrderPhase, type PublicOrderPhase } from './public-order/public-order-phase';
import '@/styles/brand-tokens.css';
import '@/styles/public-order.css';

function readCartDraft(tableToken: string) {
  const storage = typeof window === 'undefined' ? null : window.sessionStorage;
  if (!storage || typeof storage.getItem !== 'function') {
    return createEmptyPublicOrderCartDraft();
  }
  const key = publicOrderCartStorageKey(tableToken);
  const raw = storage.getItem(key);
  if (!raw) return createEmptyPublicOrderCartDraft();
  try {
    return sanitizePublicOrderCartDraft(JSON.parse(raw));
  } catch {
    return createEmptyPublicOrderCartDraft();
  }
}

function readLastOrderToken(tableToken: string) {
  const storage = typeof window === 'undefined' ? null : window.localStorage;
  if (!storage || typeof storage.getItem !== 'function') return '';
  return storage.getItem(publicOrderLastOrderStorageKey(tableToken))?.trim() || '';
}

function findCartLine(draft: PublicOrderCartDraft, productId: string) {
  return draft.items.find((item) => item.productId === productId) ?? null;
}

function statusBadgeClass(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('approved') || normalized.includes('done') || normalized === 'paid') {
    return 'border-[hsl(var(--pos-success)/0.35)] bg-[hsl(var(--pos-success-soft))] text-[hsl(152_60%_28%)]';
  }
  if (normalized.includes('pending') || normalized.includes('created')) {
    return 'border-[hsl(var(--pos-accent)/0.25)] bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]';
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('failed')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function PublicShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('public-order-root brand-surface min-h-screen bg-[hsl(var(--pos-bg))] text-slate-900', className)}>
      {children}
    </div>
  );
}

function PublicStatePanel({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]">
        {icon}
      </div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

function ReceiptPanel({
  receipt,
  currencyCode,
  canContinueOrdering,
  onContinueOrdering,
  onRefresh,
  refreshPending,
  tableUnavailableMessage,
  phase,
  phaseAnimationKey,
}: {
  receipt: PublicOrderReceiptView;
  currencyCode: string;
  canContinueOrdering: boolean;
  onContinueOrdering: () => void;
  onRefresh: () => void;
  refreshPending: boolean;
  tableUnavailableMessage: string | null;
  phase: PublicOrderPhase;
  phaseAnimationKey: number;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-8 lg:max-w-5xl lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_320px]">
        <div className="space-y-5">
          <StatusHero phase={phase} receipt={receipt} animationKey={phaseAnimationKey} />

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[hsl(var(--pos-accent))]">Đơn bàn</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  {receipt.tableName || receipt.tableCode || 'Bàn'}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={cn('rounded-full border px-3 py-0.5 text-xs font-semibold', statusBadgeClass(receipt.orderStatus))}>
                  {formatPublicLabel(receipt.orderStatus, 'Trạng thái')}
                </Badge>
                <Badge className={cn('rounded-full border px-3 py-0.5 text-xs font-semibold', statusBadgeClass(receipt.paymentStatus))}>
                  {formatPublicLabel(receipt.paymentStatus, 'Thanh toán')}
                </Badge>
              </div>
            </div>

            <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <ReceiptMeta label="Mã đơn" value={shortPublicOrderRef(receipt.orderToken)} />
              <ReceiptMeta label="Cửa hàng" value={String(receipt.outletName || receipt.outletCode || '—')} />
              <ReceiptMeta label="Lúc gọi" value={formatPublicDateTime(receipt.createdAt)} />
              <ReceiptMeta label="Tổng" value={formatPublicCurrency(receipt.totalAmount, currencyCode)} />
            </div>

            {receipt.note && phase !== 'cancelled' ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <p className="text-xs font-semibold text-slate-500">Ghi chú</p>
                <p className="mt-1 whitespace-pre-wrap">{receipt.note}</p>
              </div>
            ) : null}

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold text-slate-500">Món đã gọi</p>
              {(receipt.items || []).map((item) => (
                <div
                  key={`${item.productId || item.productCode}-${item.note || ''}-${item.status || ''}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {productDisplayName({
                          name: item.productName,
                          code: item.productCode,
                          productId: item.productId,
                        })}
                      </p>
                      {item.status ? (
                        <Badge className={cn('rounded-full border px-2 py-0 text-[10px] font-semibold', statusBadgeClass(item.status))}>
                          {formatPublicLabel(item.status, 'Trạng thái')}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {String(item.quantity || 0)} × {formatPublicCurrency(item.unitPrice, currencyCode)}
                    </p>
                    {item.note ? <p className="mt-1 text-xs text-slate-600">Ghi chú: {item.note}</p> : null}
                  </div>
                  <p className="text-sm font-bold text-slate-900">{formatPublicCurrency(item.lineTotal, currencyCode)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-[hsl(var(--pos-accent))]">Cập nhật trạng thái</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {phase === 'approved'
                ? 'Màn hình sẽ chuyển sang xác nhận khi thu ngân ghi nhận thanh toán.'
                : 'Trang tự làm mới khi đang mở. Bấm làm mới nếu nhân viên vừa cập nhật.'}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="outline" className="h-11 gap-2" onClick={onRefresh} disabled={refreshPending}>
                {refreshPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Làm mới
              </Button>
              <Button className="accent-bg h-11 gap-2" onClick={onContinueOrdering} disabled={!canContinueOrdering}>
                Gọi thêm món
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {tableUnavailableMessage ? (
              <p className="mt-3 text-xs text-[hsl(var(--pos-accent))]">{tableUnavailableMessage}</p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ReceiptMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function PublicOrderPage() {
  const { tableToken = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const orderToken = searchParams.get('order')?.trim() || '';
  const [cart, setCart] = useState<PublicOrderCartDraft>(() => readCartDraft(tableToken));
  const [cartOpen, setCartOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const deferredSearchValue = useDeferredValue(searchValue);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [lastOrderToken, setLastOrderToken] = useState(() => readLastOrderToken(tableToken));
  const [resumeOfferHidden, setResumeOfferHidden] = useState(Boolean(orderToken));

  useEffect(() => {
    setCart(readCartDraft(tableToken));
    setSearchValue('');
    setReviewRequired(false);
    setSubmitErrorMessage(null);
    setLastOrderToken(readLastOrderToken(tableToken));
    setResumeOfferHidden(Boolean(orderToken));
    setCartOpen(false);
  }, [orderToken, tableToken]);

  useEffect(() => {
    const storage = typeof window === 'undefined' ? null : window.sessionStorage;
    if (!storage || typeof storage.removeItem !== 'function' || typeof storage.setItem !== 'function') return;
    const key = publicOrderCartStorageKey(tableToken);
    if (!cart.items.length && !cart.note.trim()) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(cart));
  }, [cart, tableToken]);

  const tableQuery = useQuery({
    queryKey: ['sales', 'public', 'table', tableToken],
    queryFn: () => salesApi.getPublicTable(tableToken),
    enabled: Boolean(tableToken),
    retry: false,
  });

  const menuQuery = useQuery({
    queryKey: ['sales', 'public', 'menu', tableToken],
    queryFn: () => salesApi.listPublicMenu(tableToken),
    enabled: Boolean(tableToken) && tableQuery.isSuccess,
    retry: false,
  });

  const receiptQuery = useQuery({
    queryKey: ['sales', 'public', 'order', tableToken, orderToken],
    queryFn: () => salesApi.getPublicOrder(tableToken, orderToken),
    enabled: Boolean(tableToken) && Boolean(orderToken),
    retry: false,
    refetchInterval: (query) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
      const current = derivePublicOrderPhase(query.state.data as PublicOrderReceiptView | undefined);
      if (current === 'paid' || current === 'cancelled') return false;
      if (current === 'approved') return 8_000;
      return PUBLIC_ORDER_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
  });

  const currencyCode = String(
    receiptQuery.data?.currencyCode
      || tableQuery.data?.currencyCode
      || menuQuery.data?.[0]?.currencyCode
      || 'VND',
  ).toUpperCase();

  const menuByProductId = useMemo(
    () => new Map((menuQuery.data || []).map((item) => [String(item.productId || ''), item])),
    [menuQuery.data],
  );

  const menuCategories = useMemo(
    () => groupPublicMenuByCategory(menuQuery.data || []),
    [menuQuery.data],
  );

  const filteredCategories = useMemo(() => {
    const normalizedQuery = deferredSearchValue.trim().toLowerCase();
    if (!normalizedQuery) return menuCategories;
    return menuCategories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          const haystack = [item.name, item.code, item.description, item.categoryCode].join(' ').toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      }))
      .filter((category) => category.items.length > 0);
  }, [deferredSearchValue, menuCategories]);

  const cartSummary = useMemo(
    () => computePublicOrderCartSummary(cart, menuByProductId),
    [cart, menuByProductId],
  );

  const activeReceipt = receiptQuery.data ?? null;
  const currentPhase = derivePublicOrderPhase(activeReceipt);
  const prevPhaseRef = useRef<PublicOrderPhase | null>(null);
  const [phaseAnimationKey, setPhaseAnimationKey] = useState(0);

  useEffect(() => {
    if (!activeReceipt) {
      prevPhaseRef.current = null;
      return;
    }
    const prev = prevPhaseRef.current;
    if (prev === currentPhase) return;
    prevPhaseRef.current = currentPhase;
    if (prev === null) return;
    setPhaseAnimationKey((k) => k + 1);
    if (currentPhase === 'approved') {
      toast.success('Đơn đã xác nhận — vui lòng thanh toán tại quầy');
    } else if (currentPhase === 'paid') {
      toast.success('Đã thanh toán — cảm ơn quý khách');
    } else if (currentPhase === 'cancelled') {
      toast.error('Đơn đã bị hủy');
    }
  }, [activeReceipt, currentPhase]);

  const tableError = asPublicApiError(tableQuery.error);
  const canResumeLastOrder = Boolean(lastOrderToken && !orderToken && !resumeOfferHidden);
  const canContinueOrdering = tableQuery.isSuccess;

  const browseModeOrderLookupError =
    orderToken && !activeReceipt && receiptQuery.isError
      ? toPublicOrderErrorMessage(
          receiptQuery.error,
          'Không tải được trạng thái đơn. Bạn vẫn có thể tiếp tục gọi món.',
        )
      : null;

  const updateCart = (recipe: (current: PublicOrderCartDraft) => PublicOrderCartDraft) => {
    setCart((current) => recipe(current));
    setReviewRequired(false);
    setSubmitErrorMessage(null);
  };

  const updateCartLine = (
    productId: string,
    recipe: (line: PublicOrderCartLine) => PublicOrderCartLine | null,
  ) => {
    updateCart((current) => {
      const existing = findCartLine(current, productId) ?? { productId, quantity: 0, note: '' };
      const nextLine = recipe(existing);
      const nextItems = current.items.filter((item) => item.productId !== productId);
      if (nextLine && nextLine.quantity > 0) {
        nextItems.push({
          productId: nextLine.productId,
          quantity: Math.max(1, Math.round(nextLine.quantity)),
          note: nextLine.note.trim(),
        });
      }
      return { ...current, items: nextItems };
    });
  };

  const adjustMenuQuantity = (productId: string, delta: number) => {
    updateCartLine(productId, (current) => ({
      ...current,
      quantity: current.quantity + delta,
    }));
  };

  const createOrderMutation = useMutation({
    mutationFn: async () => salesApi.createPublicOrder(tableToken, toCreatePublicOrderPayload(cart)),
    onSuccess: (receipt) => {
      const nextSearch = new URLSearchParams(searchParams);
      nextSearch.set('order', String(receipt.orderToken));
      setCart(createEmptyPublicOrderCartDraft());
      setReviewRequired(false);
      setSubmitErrorMessage(null);
      setLastOrderToken(String(receipt.orderToken));
      setResumeOfferHidden(true);
      setCartOpen(false);
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(publicOrderLastOrderStorageKey(tableToken), String(receipt.orderToken));
      }
      queryClient.setQueryData(['sales', 'public', 'order', tableToken, receipt.orderToken], receipt);
      setSearchParams(nextSearch, { replace: true });
      toast.success('Đã gửi yêu cầu gọi món');
    },
    onError: async (error) => {
      if (isPublicOrderUnavailableError(error)) {
        await Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
        setReviewRequired(true);
        setCartOpen(true);
      }
      setSubmitErrorMessage(
        toPublicOrderErrorMessage(error, 'Không gửi được yêu cầu. Vui lòng làm mới thực đơn và thử lại.'),
      );
    },
  });

  const submitOrder = () => {
    if (cart.items.length === 0) {
      setCartOpen(true);
      return;
    }
    if (cartSummary.invalidProductIds.length > 0 || reviewRequired) {
      setCartOpen(true);
      return;
    }
    void createOrderMutation.mutateAsync();
  };

  const openReceipt = (token: string) => {
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.set('order', token);
    setResumeOfferHidden(true);
    setSearchParams(nextSearch, { replace: true });
  };

  const clearReceipt = () => {
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete('order');
    setResumeOfferHidden(true);
    setSearchParams(nextSearch, { replace: true });
  };

  const cartPanelProps = {
    cart,
    cartSummary,
    menuByProductId,
    currencyCode,
    reviewRequired,
    submitErrorMessage,
    browseModeOrderLookupError,
    submitting: createOrderMutation.isPending,
    onUpdateCart: updateCart,
    onUpdateLine: updateCartLine,
    onSubmit: submitOrder,
  };

  if (!tableToken) {
    return (
      <PublicShell>
        <PublicStatePanel
          title="Liên kết không hợp lệ"
          description="Mã bàn bị thiếu. Vui lòng quét lại mã QR hoặc nhờ nhân viên cung cấp link mới."
          icon={<CircleAlert className="h-6 w-6" />}
          action={<Link className="text-sm font-medium text-[hsl(var(--pos-accent))] underline" to="/">Về trang chủ</Link>}
        />
      </PublicShell>
    );
  }

  if (activeReceipt) {
    return (
      <PublicShell>
        <PublicOrderHeader
          table={tableQuery.data}
          tableToken={tableToken}
          searchValue=""
          onSearchChange={() => {}}
        />
        <ReceiptPanel
          receipt={activeReceipt}
          currencyCode={currencyCode}
          canContinueOrdering={canContinueOrdering}
          onContinueOrdering={clearReceipt}
          onRefresh={() => { void receiptQuery.refetch(); }}
          refreshPending={receiptQuery.isRefetching}
          tableUnavailableMessage={
            !tableQuery.isSuccess && tableError?.status === 409
              ? tableError.message || 'Bàn này hiện không nhận gọi món mới.'
              : null
          }
          phase={currentPhase}
          phaseAnimationKey={phaseAnimationKey}
        />
      </PublicShell>
    );
  }

  if (tableQuery.isLoading || (orderToken && receiptQuery.isLoading && !tableQuery.data)) {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--pos-accent))]" />
          <p className="text-sm text-slate-600">Đang tải thực đơn...</p>
        </div>
      </PublicShell>
    );
  }

  if (isPublicOrderNotFoundError(tableQuery.error) || isPublicOrderNotFoundError(menuQuery.error)) {
    return (
      <PublicShell>
        <PublicStatePanel
          title="Không tìm thấy bàn"
          description="Link hoặc mã QR không còn hiệu lực. Vui lòng nhờ nhân viên cung cấp link mới."
          icon={<CircleAlert className="h-6 w-6" />}
          action={<Button asChild><Link to="/">Về trang chủ</Link></Button>}
        />
      </PublicShell>
    );
  }

  if (isPublicOrderUnavailableError(tableQuery.error) || isPublicOrderUnavailableError(menuQuery.error)) {
    return (
      <PublicShell>
        <PublicStatePanel
          title="Tạm ngưng gọi món"
          description={toPublicOrderErrorMessage(
            tableQuery.error || menuQuery.error,
            'Bàn hoặc cửa hàng đang tạm dừng nhận gọi món từ khách.',
          )}
          icon={<CircleAlert className="h-6 w-6" />}
          action={(
            <Button variant="outline" className="gap-2" onClick={() => {
              void Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
            }}>
              <RefreshCcw className="h-4 w-4" />
              Thử lại
            </Button>
          )}
        />
      </PublicShell>
    );
  }

  if (tableQuery.isError || menuQuery.isError) {
    return (
      <PublicShell>
        <PublicStatePanel
          title="Không tải được thực đơn"
          description={toPublicOrderErrorMessage(tableQuery.error || menuQuery.error, 'Vui lòng làm mới trang và thử lại.')}
          icon={<CircleAlert className="h-6 w-6" />}
          action={(
            <Button variant="outline" className="gap-2" onClick={() => {
              void Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
            }}>
              <RefreshCcw className="h-4 w-4" />
              Thử lại
            </Button>
          )}
        />
      </PublicShell>
    );
  }

  const searchActive = deferredSearchValue.trim().length > 0;
  const canSubmitFromBar = !createOrderMutation.isPending
    && cart.items.length > 0
    && cartSummary.invalidProductIds.length === 0
    && !reviewRequired;

  return (
    <PublicShell className={isMobile ? 'pb-[calc(5rem+var(--po-safe-bottom,0px))]' : undefined}>
      <PublicOrderHeader
        table={tableQuery.data}
        tableToken={tableToken}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {canResumeLastOrder ? (
        <div className="mx-4 mb-2 mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:mx-6 sm:flex-row sm:items-center sm:justify-between lg:mx-8">
          <p className="text-sm text-slate-600">
            Đơn trước <span className="font-semibold text-slate-900">{shortPublicOrderRef(lastOrderToken)}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResumeOfferHidden(true)}>Bỏ qua</Button>
            <Button size="sm" className="accent-bg" onClick={() => openReceipt(lastOrderToken)}>Xem trạng thái</Button>
          </div>
        </div>
      ) : null}

      <div className="lg:mx-8 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5">
        <PublicMenuBrowser
          categories={menuCategories}
          filteredCategories={filteredCategories}
          cart={cart}
          currencyCode={currencyCode}
          loading={menuQuery.isLoading}
          searchActive={searchActive}
          onAdjustQuantity={adjustMenuQuantity}
        />

        <aside className="hidden lg:block lg:py-4 lg:pr-4">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <PublicOrderCartPanel variant="desktop" {...cartPanelProps} />
          </div>
        </aside>
      </div>

      {isMobile ? (
        <PublicOrderCartBar
          itemCount={cartSummary.itemCount}
          subtotal={cartSummary.subtotal}
          currencyCode={currencyCode}
          disabled={!canSubmitFromBar}
          onOpenCart={() => setCartOpen(true)}
          onSubmit={submitOrder}
        />
      ) : null}

      {isMobile ? (
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl border-slate-200 bg-white px-4 pb-8 pt-5 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Giỏ gọi món</SheetTitle>
            <SheetDescription>Món đã chọn cho bàn này.</SheetDescription>
          </SheetHeader>
          <PublicOrderCartPanel variant="sheet" {...cartPanelProps} />
        </SheetContent>
      </Sheet>
      ) : null}
    </PublicShell>
  );
}
