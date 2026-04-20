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
  Clock3,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  RefreshCcw,
  Search,
  ShoppingBag,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import { toast } from 'sonner';
import { salesApi, type PublicMenuItemView, type PublicOrderReceiptView } from '@/api/fern-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
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
import { StatusHero, derivePublicOrderPhase, type PublicOrderPhase } from './public-order/StatusHero';
import '@/styles/brand-tokens.css';

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'VND' ? 0 : 2,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(toNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

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

function productName(item: Pick<PublicMenuItemView, 'name' | 'code' | 'productId'>) {
  return String(item.name || item.code || item.productId || 'Menu item');
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

function findCartLine(draft: PublicOrderCartDraft, productId: string) {
  return draft.items.find((item) => item.productId === productId) ?? null;
}

function PublicShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="brand-surface min-h-screen bg-[hsl(var(--pos-bg))] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        {header}
        <div className="mt-6 flex-1">{children}</div>
      </div>
    </div>
  );
}

function PublicStatePanel({
  eyebrow,
  title,
  description,
  action,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] px-6 py-10 text-center shadow-md">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--pos-accent)/0.25)] bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]">
        {icon}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[hsl(var(--pos-accent))]">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
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
    <section className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px]">
      <div className="space-y-5">
        <StatusHero phase={phase} receipt={receipt} animationKey={phaseAnimationKey} />

        <div className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[hsl(var(--pos-accent))]">Table order</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {receipt.tableName || receipt.tableCode || 'Table order'}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', statusBadgeClass(receipt.orderStatus))}>
                {formatPublicLabel(receipt.orderStatus, 'Order status')}
              </Badge>
              <Badge className={cn('rounded-full border px-3 py-1 text-[11px] font-semibold', statusBadgeClass(receipt.paymentStatus))}>
                {formatPublicLabel(receipt.paymentStatus, 'Payment status')}
              </Badge>
            </div>
          </div>

          <div className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <ReceiptMeta label="Order ref" value={shortPublicOrderRef(receipt.orderToken)} />
            <ReceiptMeta label="Outlet" value={String(receipt.outletName || receipt.outletCode || '—')} />
            <ReceiptMeta label="Placed at" value={formatDateTime(receipt.createdAt)} />
            <ReceiptMeta label="Total" value={formatCurrency(receipt.totalAmount, currencyCode)} />
          </div>

          {receipt.note && phase !== 'cancelled' ? (
            <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Order note</p>
              <p className="mt-2 whitespace-pre-wrap">{receipt.note}</p>
            </div>
          ) : null}

          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Submitted items</p>
            <div className="mt-3 space-y-3">
              {(receipt.items || []).map((item) => (
                <div key={`${item.productId || item.productCode}-${item.note || ''}`} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{String(item.productName || item.productCode || item.productId || 'Menu item')}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {String(item.quantity || 0)} x {formatCurrency(item.unitPrice, currencyCode)}
                    </p>
                    {item.note ? <p className="mt-2 text-xs text-slate-600">Note: {item.note}</p> : null}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(item.lineTotal, currencyCode)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">Status refresh</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {phase === 'approved'
              ? 'This screen flips to a confirmation once the cashier records your payment at the counter.'
              : 'This receipt refreshes automatically while the page is visible. Use manual refresh if staff just updated the order.'}
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <Button variant="outline" className="h-11 justify-center gap-2" onClick={onRefresh} disabled={refreshPending}>
              {refreshPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh status
            </Button>
            <Button className="accent-bg h-11 justify-center gap-2" onClick={onContinueOrdering} disabled={!canContinueOrdering}>
              Continue ordering
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {tableUnavailableMessage ? <p className="mt-3 text-xs leading-5 text-[hsl(var(--pos-accent))]">{tableUnavailableMessage}</p> : null}
        </div>

        <div className="accent-soft-bg rounded-2xl border border-[hsl(var(--pos-accent)/0.2)] px-5 py-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">What happens next</p>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Request is in the staff queue. Cashier approves, kitchen prepares, and payment is collected at the counter.
          </p>
        </div>
      </aside>
    </section>
  );
}

function ReceiptMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
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
  const [selectedCategory, setSelectedCategory] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [lastOrderToken, setLastOrderToken] = useState(() => readLastOrderToken(tableToken));
  const [resumeOfferHidden, setResumeOfferHidden] = useState(Boolean(orderToken));
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setCart(readCartDraft(tableToken));
    setSearchValue('');
    setSelectedCategory('');
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
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return false;
      }
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
      || 'USD',
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
    if (!normalizedQuery) {
      return menuCategories;
    }
    return menuCategories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          const haystack = [
            item.name,
            item.code,
            item.description,
            item.categoryCode,
          ].join(' ').toLowerCase();
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
      toast.success('Order approved — please pay at the counter');
    } else if (currentPhase === 'paid') {
      toast.success('Payment received — thank you');
    } else if (currentPhase === 'cancelled') {
      toast.error('Staff cancelled this order');
    }
  }, [activeReceipt, currentPhase]);
  const tableError = asPublicApiError(tableQuery.error);
  const menuError = asPublicApiError(menuQuery.error);
  const canResumeLastOrder = Boolean(lastOrderToken && !orderToken && !resumeOfferHidden);
  const canContinueOrdering = tableQuery.isSuccess;

  const browseModeOrderLookupError =
    orderToken && !activeReceipt && receiptQuery.isError
      ? toPublicOrderErrorMessage(
          receiptQuery.error,
          'We could not load this order status. You can continue ordering from the live menu below.',
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
      return {
        ...current,
        items: nextItems,
      };
    });
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
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(publicOrderLastOrderStorageKey(tableToken), String(receipt.orderToken));
      }
      queryClient.setQueryData(['sales', 'public', 'order', tableToken, receipt.orderToken], receipt);
      setSearchParams(nextSearch, { replace: true });
      toast.success('Order request sent to the staff queue');
    },
    onError: async (error) => {
      if (isPublicOrderUnavailableError(error)) {
        await Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
        setReviewRequired(true);
      }
      setSubmitErrorMessage(
        toPublicOrderErrorMessage(
          error,
          'We could not send this request right now. Refresh the menu and try again.',
        ),
      );
    },
  });

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

  const header = (
    <header className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] px-5 py-5 shadow-sm sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[hsl(var(--pos-accent))]">Public dining</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Order directly from your table
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Send an order request to the staff queue. Payment is collected at the counter — this screen updates automatically once staff approves or settles your order.
          </p>
        </div>

        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700 sm:grid-cols-2 sm:gap-4 lg:min-w-[360px] lg:grid-cols-1">
          <div className="flex items-start gap-3">
            <Store className="mt-0.5 h-4 w-4 text-[hsl(var(--pos-accent))]" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Outlet</p>
              <p className="mt-1 font-medium text-slate-900">
                {String(
                  activeReceipt?.outletName
                  || activeReceipt?.outletCode
                  || tableQuery.data?.outletName
                  || tableQuery.data?.outletCode
                  || 'Loading outlet…',
                )}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <UtensilsCrossed className="mt-0.5 h-4 w-4 text-[hsl(var(--pos-accent))]" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Table</p>
              <p className="mt-1 font-medium text-slate-900">
                {String(
                  activeReceipt?.tableName
                  || activeReceipt?.tableCode
                  || tableQuery.data?.tableName
                  || tableQuery.data?.tableCode
                  || tableToken
                  || '—',
                )}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-4 w-4 text-[hsl(var(--pos-accent))]" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Business date</p>
              <p className="mt-1 font-medium text-slate-900">{formatDate(tableQuery.data?.businessDate)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ReceiptText className="mt-0.5 h-4 w-4 text-[hsl(var(--pos-accent))]" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Flow</p>
              <p className="mt-1 font-medium text-slate-900">Menu request only</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );

  if (!tableToken) {
    return (
      <PublicShell header={header}>
        <PublicStatePanel
          eyebrow="Invalid link"
          title="Missing table token"
          description="This public ordering link is incomplete. Ask the staff for a fresh QR code or table link."
          icon={<CircleAlert className="h-6 w-6" />}
          action={<Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/">Back to app</Link>}
        />
      </PublicShell>
    );
  }

  if (activeReceipt) {
    return (
      <PublicShell header={header}>
        <ReceiptPanel
          receipt={activeReceipt}
          currencyCode={currencyCode}
          canContinueOrdering={canContinueOrdering}
          onContinueOrdering={clearReceipt}
          onRefresh={() => {
            void receiptQuery.refetch();
          }}
          refreshPending={receiptQuery.isRefetching}
          tableUnavailableMessage={
            !tableQuery.isSuccess && tableError?.status === 409
              ? tableError.message || 'This table is no longer accepting new customer orders.'
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
      <PublicShell header={header}>
        <PublicStatePanel
          eyebrow="Loading"
          title="Preparing your table workspace"
          description="We are resolving the table link and current menu from the live backend."
          icon={<Loader2 className="h-6 w-6 animate-spin" />}
        />
      </PublicShell>
    );
  }

  if (isPublicOrderNotFoundError(tableQuery.error) || isPublicOrderNotFoundError(menuQuery.error)) {
    return (
      <PublicShell header={header}>
        <PublicStatePanel
          eyebrow="Invalid link"
          title="This table link could not be found"
          description="The QR code or customer route is no longer valid. Ask the staff for a fresh ordering link."
          icon={<CircleAlert className="h-6 w-6" />}
          action={<Button asChild><Link to="/">Return to the app</Link></Button>}
        />
      </PublicShell>
    );
  }

  if (isPublicOrderUnavailableError(tableQuery.error) || isPublicOrderUnavailableError(menuQuery.error)) {
    return (
      <PublicShell header={header}>
        <PublicStatePanel
          eyebrow="Temporarily unavailable"
          title="This table is not accepting customer orders"
          description={toPublicOrderErrorMessage(tableQuery.error || menuQuery.error, 'The staff has paused public ordering for this table or outlet right now.')}
          icon={<CircleAlert className="h-6 w-6" />}
          action={(
            <Button variant="outline" className="gap-2" onClick={() => {
              void Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
            }}>
              <RefreshCcw className="h-4 w-4" />
              Refresh availability
            </Button>
          )}
        />
      </PublicShell>
    );
  }

  if (tableQuery.isError || menuQuery.isError) {
    return (
      <PublicShell header={header}>
        <PublicStatePanel
          eyebrow="Connection issue"
          title="We could not load the public menu"
          description={toPublicOrderErrorMessage(tableQuery.error || menuQuery.error, 'Refresh the page and try again.')}
          icon={<CircleAlert className="h-6 w-6" />}
          action={(
            <Button variant="outline" className="gap-2" onClick={() => {
              void Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
            }}>
              <RefreshCcw className="h-4 w-4" />
              Retry
            </Button>
          )}
        />
      </PublicShell>
    );
  }

  const renderCartPanel = (variant: 'desktop' | 'mobile') => (
    <div className={cn(
      'rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-5 shadow-sm',
      variant === 'desktop' && 'lg:sticky lg:top-6',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">Cart</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Review this table request</h2>
        </div>
        <Badge className="accent-soft-bg rounded-full border border-[hsl(var(--pos-accent)/0.25)] px-3 py-1 text-[11px] font-semibold text-[hsl(var(--pos-accent))]">
          {cartSummary.itemCount} item{cartSummary.itemCount === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="mt-5 space-y-3">
        {cart.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[hsl(var(--pos-accent)/0.35)] bg-white px-4 py-6 text-sm leading-6 text-slate-600">
            Add items from the menu. Your request will be sent to the staff queue for review and fulfilment.
          </div>
        ) : (
          cart.items.map((item) => {
            const menuItem = menuByProductId.get(item.productId);
            const invalid = cartSummary.invalidProductIds.includes(item.productId) || reviewRequired;
            return (
              <div
                key={item.productId}
                className={cn(
                  'rounded-xl border px-4 py-3',
                  invalid ? 'border-[hsl(var(--pos-accent)/0.45)] bg-[hsl(var(--pos-accent-soft))]' : 'border-slate-200 bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {menuItem ? productName(menuItem) : `Unavailable item ${item.productId}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {menuItem ? formatCurrency(menuItem.priceValue, currencyCode) : 'Refresh menu and remove this item'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
                      onClick={() => updateCartLine(item.productId, (current) => ({ ...current, quantity: current.quantity - 1 }))}
                      aria-label={`Remove one ${menuItem ? productName(menuItem) : item.productId}`}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[1.5rem] text-center text-sm font-semibold text-slate-900">{item.quantity}</span>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
                      onClick={() => updateCartLine(item.productId, (current) => ({ ...current, quantity: current.quantity + 1 }))}
                      aria-label={`Add one ${menuItem ? productName(menuItem) : item.productId}`}
                      disabled={!menuItem}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <Label htmlFor={`item-note-${variant}-${item.productId}`} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Item note
                  </Label>
                  <Textarea
                    id={`item-note-${variant}-${item.productId}`}
                    className="mt-2 min-h-[76px] resize-none border-slate-200 bg-white text-sm"
                    placeholder="No onions, less ice, serve later..."
                    value={item.note}
                    onChange={(event) => updateCartLine(item.productId, (current) => ({ ...current, note: event.target.value }))}
                  />
                  {invalid ? <p className="mt-2 text-xs leading-5 text-[hsl(var(--pos-accent))]">This line needs review before you can submit again.</p> : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-5">
        <Label htmlFor={`order-note-${variant}`} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Order note
        </Label>
        <Textarea
          id={`order-note-${variant}`}
          className="mt-2 min-h-[96px] resize-none border-slate-200 bg-slate-50 text-sm"
          placeholder="Anything the staff should know about this table request?"
          value={cart.note}
          onChange={(event) => updateCart((current) => ({ ...current, note: event.target.value }))}
        />
      </div>

      {browseModeOrderLookupError ? (
        <div className="mt-4 rounded-xl border border-[hsl(var(--pos-accent)/0.3)] bg-[hsl(var(--pos-accent-soft))] px-4 py-3 text-sm leading-6 text-slate-800">
          {browseModeOrderLookupError}
        </div>
      ) : null}

      {submitErrorMessage ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
          {submitErrorMessage}
        </div>
      ) : null}

      <Separator className="my-5 bg-slate-200" />

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>Subtotal</span>
        <span className="font-semibold text-slate-900">{formatCurrency(cartSummary.subtotal, currencyCode)}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Public payment is not available. This sends an order request to staff for approval and fulfilment.
      </p>

      <Button
        className="accent-bg mt-5 h-12 w-full gap-2"
        disabled={
          createOrderMutation.isPending
          || cart.items.length === 0
          || cartSummary.invalidProductIds.length > 0
          || reviewRequired
        }
        onClick={() => {
          void createOrderMutation.mutateAsync();
        }}
      >
        {createOrderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
        Send order request
      </Button>
    </div>
  );

  return (
    <PublicShell header={header}>
      {canResumeLastOrder ? (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Resume last order</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              You previously submitted order <span className="font-medium text-slate-900">{shortPublicOrderRef(lastOrderToken)}</span> for this table.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="h-10" onClick={() => setResumeOfferHidden(true)}>
              Dismiss
            </Button>
            <Button className="accent-bg h-10 gap-2" onClick={() => openReceipt(lastOrderToken)}>
              Resume order status
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">Menu</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                {tableQuery.data?.tableName || tableQuery.data?.tableCode || 'Public table menu'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Browse the live menu for this table, then send one consolidated request to the staff queue.
              </p>
            </div>
            <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <Search className="h-4 w-4 text-[hsl(var(--pos-accent))]" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search menu item or category"
                className="h-auto border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
          </div>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
            {menuCategories.map((category) => (
              <button
                key={category.code}
                type="button"
                className={cn(
                  'whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition',
                  selectedCategory === category.code
                    ? 'accent-bg border-transparent'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[hsl(var(--pos-accent)/0.4)] hover:bg-[hsl(var(--pos-accent-soft))]',
                )}
                onClick={() => {
                  setSelectedCategory(category.code);
                  categoryRefs.current[category.code]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {category.label}
              </button>
            ))}
          </div>

          {menuQuery.isLoading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
              <p className="text-lg font-semibold text-slate-900">
                {menuCategories.length === 0 ? 'No menu items are available right now' : 'No menu items match this search'}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {menuCategories.length === 0
                  ? 'The backend returned an empty public menu for this table. Ask the staff to refresh the outlet catalog.'
                  : 'Try a different search term or jump to another category.'}
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-8">
              {filteredCategories.map((category) => (
                <div key={category.code} ref={(node) => {
                  categoryRefs.current[category.code] = node;
                }}>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">Category</p>
                      <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{category.label}</h3>
                    </div>
                    <p className="text-sm text-slate-500">{category.items.length} item{category.items.length === 1 ? '' : 's'}</p>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {category.items.map((item) => {
                      const cartLine = findCartLine(cart, String(item.productId || ''));
                      return (
                        <article key={String(item.productId || item.code)} className="pos-card-item group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-[hsl(var(--pos-accent)/0.4)]">
                          <div className="aspect-[16/10] bg-[hsl(var(--pos-accent-soft))]">
                            {item.imageUrl ? (
                              <img src={String(item.imageUrl)} alt={productName(item)} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-between px-5">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[hsl(var(--pos-accent))]">{formatPublicLabel(item.categoryCode, 'Menu')}</p>
                                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{String(item.code || '').slice(0, 8) || 'Menu'}</p>
                                </div>
                                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[hsl(var(--pos-accent)/0.25)] bg-white text-lg font-semibold text-[hsl(var(--pos-accent))]">
                                  {productName(item).slice(0, 2).toUpperCase()}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="text-lg font-semibold tracking-tight text-slate-900">{productName(item)}</h4>
                                <p className="mt-1 text-sm text-slate-500">{String(item.code || formatPublicLabel(item.categoryCode, 'Menu item'))}</p>
                              </div>
                              <p className="text-sm font-semibold text-[hsl(var(--pos-accent))]">{formatCurrency(item.priceValue, currencyCode)}</p>
                            </div>
                            <p className="mt-3 min-h-[48px] text-sm leading-6 text-slate-600">
                              {item.description || 'Prepared fresh for table ordering. Staff will confirm the request before service.'}
                            </p>

                            <div className="mt-4 flex items-center justify-between gap-3">
                              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
                                  onClick={() => updateCartLine(String(item.productId || ''), (current) => ({ ...current, quantity: current.quantity - 1 }))}
                                  aria-label={`Remove one ${productName(item)}`}
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="min-w-[1.5rem] text-center text-sm font-semibold text-slate-900">{cartLine?.quantity || 0}</span>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
                                  onClick={() => updateCartLine(String(item.productId || ''), (current) => ({ ...current, quantity: current.quantity + 1 }))}
                                  aria-label={`Add ${productName(item)}`}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                              <Button
                                variant={cartLine ? 'outline' : 'default'}
                                className={cn('h-10 min-w-[120px]', !cartLine && 'accent-bg')}
                                onClick={() => updateCartLine(String(item.productId || ''), (current) => ({ ...current, quantity: current.quantity + 1 }))}
                              >
                                {cartLine ? 'Add more' : 'Add to cart'}
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="hidden lg:block">
          {renderCartPanel('desktop')}
        </aside>
      </div>

      {isMobile ? (
        <>
          <button
            type="button"
            className="accent-bg fixed inset-x-4 bottom-4 z-30 flex items-center justify-between gap-4 rounded-full px-5 py-3 text-left shadow-md"
            onClick={() => setCartOpen(true)}
          >
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.28em] text-white/80">Cart</span>
              <span className="mt-1 block text-sm font-medium">{cartSummary.itemCount} item{cartSummary.itemCount === 1 ? '' : 's'} ready</span>
            </span>
            <span className="text-sm font-semibold">{formatCurrency(cartSummary.subtotal, currencyCode)}</span>
          </button>
          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl border-slate-200 bg-[hsl(var(--pos-surface))] px-4 pb-8 pt-5">
              <SheetHeader className="sr-only">
                <SheetTitle>Public order cart</SheetTitle>
                <SheetDescription>Review the current request for this table.</SheetDescription>
              </SheetHeader>
              {renderCartPanel('mobile')}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </PublicShell>
  );
}
