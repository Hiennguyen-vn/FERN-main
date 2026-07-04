import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { salesApi, type PublicMenuItemView, type PublicOrderReceiptView } from '@/api/fern-api';
import { Button } from '@/components/ui/button';
import {
  PUBLIC_ORDER_POLL_INTERVAL_MS,
  asPublicApiError,
  computePublicOrderCartSummary,
  createEmptyPublicOrderCartDraft,
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
import { CartFab, CartMobileSheet } from './public-order/CartFab';
import { CartPanel } from './public-order/CartPanel';
import { MenuSection } from './public-order/MenuSection';
import { PublicOrderHeader } from './public-order/PublicOrderHeader';
import { PublicShell } from './public-order/PublicShell';
import { PublicStatePanel } from './public-order/PublicStatePanel';
import { ReceiptPanel } from './public-order/ReceiptPanel';
import { derivePublicOrderPhase, type PublicOrderPhase } from './public-order/public-order-phase';
import { findCartLine } from './public-order/utils';
import '@/styles/brand-tokens.css';

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

export default function PublicOrderPage() {
  const { tableToken = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const orderToken = searchParams.get('order')?.trim() || '';
  const [cart, setCart] = useState<PublicOrderCartDraft>(() => readCartDraft(tableToken));
  const [cartOpen, setCartOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const deferredSearchValue = useDeferredValue(searchValue);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [lastOrderToken, setLastOrderToken] = useState(() => readLastOrderToken(tableToken));
  const [resumeOfferHidden, setResumeOfferHidden] = useState(Boolean(orderToken));
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setCart(readCartDraft(tableToken));
    setSearchValue('');
    setSelectedCategory('');
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
      toast.success('Order request sent to the staff queue');
    },
    onError: async (error) => {
      if (isPublicOrderUnavailableError(error)) {
        await Promise.all([tableQuery.refetch(), menuQuery.refetch()]);
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

  const handleSubmitOrder = () => {
    void createOrderMutation.mutateAsync();
  };

  const header = (
    <PublicOrderHeader
      activeReceipt={activeReceipt}
      tableQueryData={tableQuery.data}
      tableToken={tableToken}
    />
  );

  const cartPanelProps = {
    cart,
    cartSummary,
    currencyCode,
    menuByProductId: menuByProductId as Map<string, PublicMenuItemView>,
    browseModeOrderLookupError,
    submitErrorMessage,
    submitPending: createOrderMutation.isPending,
    onUpdateCart: updateCart,
    onUpdateCartLine: updateCartLine,
    onSubmit: handleSubmitOrder,
  };

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

  return (
    <PublicShell header={header} bottomPadding>
      {canResumeLastOrder ? (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-[hsl(var(--pos-surface))] px-4 py-4 shadow-sm sm:mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Resume last order</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              You previously submitted order <span className="font-medium text-slate-900">{shortPublicOrderRef(lastOrderToken)}</span> for this table.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="h-11 min-h-[44px]" onClick={() => setResumeOfferHidden(true)}>
              Dismiss
            </Button>
            <Button className="accent-bg h-11 min-h-[44px] gap-2" onClick={() => openReceipt(lastOrderToken)}>
              Resume order status
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <MenuSection
          menuLoading={menuQuery.isLoading}
          menuCategories={menuCategories}
          filteredCategories={filteredCategories}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          categoryRefs={categoryRefs}
          cart={cart}
          currencyCode={currencyCode}
          updateCartLine={updateCartLine}
        />

        <aside className="hidden lg:block">
          <CartPanel variant="desktop" {...cartPanelProps} />
        </aside>
      </div>

      <div className="lg:hidden">
        <CartFab
          itemCount={cartSummary.itemCount}
          subtotal={cartSummary.subtotal}
          currencyCode={currencyCode}
          onOpenCart={() => setCartOpen(true)}
        />
        <CartMobileSheet
          open={cartOpen}
          onOpenChange={setCartOpen}
          {...cartPanelProps}
        />
      </div>
    </PublicShell>
  );
}
