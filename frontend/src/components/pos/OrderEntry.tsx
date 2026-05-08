import { useEffect, useMemo, useState } from 'react';
import {
  Search, Monitor, Wifi, User, ShoppingBag, Plus, Minus,
  Trash2, ArrowLeft, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProductItem, OrderLineItem } from '@/types/pos';
import { cn } from '@/lib/utils';
import { productApi, salesApi, type PriceView, type ProductView, type PromotionView } from '@/api/fern-api';
import { fnbApi, type CustomerAllergyView, type ProductAllergenView } from '@/api/fnb-api';
import { crmApi, type CrmCustomerView } from '@/api/crm-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { normalizeNumericId } from '@/constants/pos';
import { calculatePromotionDiscount } from '@/components/pos/promotion-utils';
import { ModifierPicker, type SelectedModifier } from '@/components/fnb/ModifierPicker';
import { AllergenBadgeRow } from '@/components/fnb/AllergenBadgeRow';
import { EmptyState } from '@/components/shell/PermissionStates';
import { AlertTriangle, UserPlus, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { roundMoney } from '@/lib/money';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';
import { toast } from 'sonner';

type CartItem = OrderLineItem;
type ProductAllergenMapEntry = { productId: number; allergens: ProductAllergenView[] };

interface Props {
  sessionCode: string;
  outletName: string;
  cashierName: string;
  currencyCode?: string;
  onBack: () => void;
  onCheckout: (items: CartItem[], promo: string | null, promoDiscount: number) => void;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function OrderEntry({ sessionCode, outletName, cashierName, currencyCode, onBack, onCheckout }: Props) {
  const { token, scope } = useShellRuntime();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [appliedPromotion, setAppliedPromotion] = useState<PromotionView | null>(null);

  // Modifier picker state
  const [modifierTarget, setModifierTarget] = useState<ProductItem | null>(null);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [modifierCheckCache] = useState<Map<string, boolean>>(() => new Map());
  const [modifierCheckPending] = useState<Set<string>>(() => new Set());

  // Customer + allergy state
  const [customer, setCustomer] = useState<CrmCustomerView | null>(null);
  const [customerAllergies, setCustomerAllergies] = useState<CustomerAllergyView[]>([]);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CrmCustomerView[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);

  const scopedOutletId = normalizeNumericId(scope.outletId);
  const resolvedCurrencyCode = String(currencyCode ?? 'USD').trim().toUpperCase() || 'USD';

  useEffect(() => {
    const loadProducts = async () => {
      if (!token) {
        setProducts([]);
        setLoadingProducts(false);
        return;
      }

      setLoadingProducts(true);
      try {
        const [rawProducts, rawPrices, allergenMap] = await Promise.all([
          productApi.products(token),
          scopedOutletId ? productApi.prices(token, scopedOutletId) : Promise.resolve([]),
          fnbApi.listAllProductAllergens(token).catch((): ProductAllergenMapEntry[] => []),
        ]);

        const priceByProductId = new Map<string, number>();
        rawPrices.forEach((price: PriceView) => {
          priceByProductId.set(String(price.productId), toNumber(price.priceValue));
        });

        const allergensByProductId = new Map<string, ProductItem['allergens']>();
        allergenMap.forEach((entry) => {
          allergensByProductId.set(String(entry.productId), entry.allergens);
        });

        const mapped: ProductItem[] = rawProducts.flatMap((product: ProductView) => {
          const productId = String(product.id);
          const price = priceByProductId.get(productId) ?? 0;
          const active = String(product.status ?? 'active').toLowerCase() === 'active';
          if (!active || price <= 0) {
            return [];
          }
          return [{
            id: productId,
            name: String(product.name ?? `Product ${productId}`),
            category: String(product.categoryCode ?? 'Uncategorized'),
            price,
            sku: String(product.code ?? productId),
            available: true,
            allergens: allergensByProductId.get(productId) ?? [],
          }];
        });

        setProducts(mapped);
      } catch (error) {
        console.error('Failed to load POS catalog:', error);
        setProducts([]);
        toast.error('Unable to load product catalog');
      } finally {
        setLoadingProducts(false);
      }
    };

    void loadProducts();
  }, [scopedOutletId, token]);

  const categories = useMemo(() => {
    const values = Array.from(new Set(products.map((product) => product.category).filter(Boolean)));
    return ['All', ...values];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      if (category !== 'All' && product.category !== category) return false;
      if (search && !product.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [category, products, search]);

  const addToCartDirect = (product: ProductItem, modifiers: SelectedModifier[] = [], priceDelta = 0) => {
    const effectivePrice = product.price + priceDelta;
    const modifierSuffix = modifiers.length > 0 ? ` (${modifiers.map(m => m.label.split(': ')[1] ?? m.label).join(', ')})` : '';
    setCart((prev) => {
      // With modifiers, always add as new line (distinct modifier combos = distinct lines)
      if (modifiers.length > 0) {
        return [
          ...prev,
          {
            id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            productId: product.id,
            productName: `${product.name}${modifierSuffix}`,
            category: product.category,
            quantity: 1,
            unitPrice: effectivePrice,
            lineTotal: effectivePrice,
          },
        ];
      }
      const existing = prev.find((item) => item.productId === product.id && item.unitPrice === product.price);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id && item.unitPrice === product.price
            ? { ...item, quantity: item.quantity + 1, lineTotal: (item.quantity + 1) * item.unitPrice }
            : item,
        );
      }
      return [
        ...prev,
        {
          id: `li-${Date.now()}`,
          productId: product.id,
          productName: product.name,
          category: product.category,
          quantity: 1,
          unitPrice: effectivePrice,
          lineTotal: effectivePrice,
        },
      ];
    });
  };

  const addToCart = (product: ProductItem) => {
    if (!product.available) return;
    if (!token) { addToCartDirect(product); return; }
    // Cache modifier-presence per product to avoid repeated calls on rapid taps.
    const cached = modifierCheckCache.get(product.id);
    if (cached === true) {
      setModifierTarget(product);
      setModifierOpen(true);
      return;
    }
    if (cached === false) {
      addToCartDirect(product);
      return;
    }
    // De-dup in-flight requests for the same product.
    if (modifierCheckPending.has(product.id)) return;
    modifierCheckPending.add(product.id);
    fnbApi.getProductModifierGroups(token, product.id)
      .then((groups) => {
        const has = groups.length > 0;
        modifierCheckCache.set(product.id, has);
        if (has) {
          setModifierTarget(product);
          setModifierOpen(true);
        } else {
          addToCartDirect(product);
        }
      })
      .catch(() => {
        modifierCheckCache.set(product.id, false);
        addToCartDirect(product);
      })
      .finally(() => {
        modifierCheckPending.delete(product.id);
      });
  };

  const handleModifierConfirm = (selected: SelectedModifier[], priceDelta: number) => {
    if (modifierTarget) addToCartDirect(modifierTarget, selected, priceDelta);
    setModifierTarget(null);
  };

  // Customer search (debounced)
  useEffect(() => {
    if (!customerSearchOpen || !token) return;
    const handle = setTimeout(() => {
      const q = customerSearch.trim();
      if (q.length < 2) { setCustomerOptions([]); return; }
      setCustomerSearching(true);
      crmApi.customers(token, { q, outletId: scopedOutletId || undefined, limit: 10, offset: 0 })
        .then((page) => setCustomerOptions(page.items))
        .catch(() => setCustomerOptions([]))
        .finally(() => setCustomerSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [customerSearch, customerSearchOpen, scopedOutletId, token]);

  const selectCustomer = (c: CrmCustomerView) => {
    setCustomer(c);
    setCustomerSearchOpen(false);
    setCustomerSearch('');
    setCustomerOptions([]);
    if (token) {
      fnbApi.getCustomerAllergies(token, c.id)
        .then(setCustomerAllergies)
        .catch(() => setCustomerAllergies([]));
    }
  };

  const clearCustomer = () => {
    setCustomer(null);
    setCustomerAllergies([]);
  };

  // Compute allergen overlap: customer allergies × cart product allergens
  const allergenOverlap = useMemo(() => {
    if (customerAllergies.length === 0 || cart.length === 0) return [];
    const customerCodes = new Map(customerAllergies.map((a) => [a.code, a]));
    const hits: Array<{ product: string; allergy: CustomerAllergyView }> = [];
    for (const line of cart) {
      const product = products.find((p) => p.id === line.productId);
      if (!product?.allergens) continue;
      for (const al of product.allergens) {
        const matched = customerCodes.get(al.code);
        if (matched) hits.push({ product: line.productName, allergy: matched });
      }
    }
    return hits;
  }, [cart, customerAllergies, products]);

  const hasSevereAllergyHit = allergenOverlap.some((h) => h.allergy.severity === 'SEVERE' || h.allergy.severity === 'AVOID');

  const updateQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === lineId
            ? { ...item, quantity: item.quantity + delta, lineTotal: (item.quantity + delta) * item.unitPrice }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const removeItem = (lineId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== lineId));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const appliedPromoId = appliedPromotion ? String(appliedPromotion.id ?? '') : null;
  const appliedPromoLabel = appliedPromotion ? String(appliedPromotion.name ?? appliedPromotion.id ?? '') : '';
  const promoDiscount = useMemo(
    () => calculatePromotionDiscount(subtotal, appliedPromotion),
    [appliedPromotion, subtotal],
  );
  const adjustedSubtotal = Math.max(0, subtotal - promoDiscount);
  const taxRate = 0.08;
  const taxAmount = roundMoney(adjustedSubtotal * taxRate, resolvedCurrencyCode);
  const total = roundMoney(adjustedSubtotal + taxAmount, resolvedCurrencyCode);

  const applyPromo = () => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }
    const code = promoCode.trim();
    if (!code) return;

    setPromoBusy(true);
    void salesApi.promotions(token, {
      outletId: scopedOutletId || undefined,
      status: 'active',
      limit: 100,
      offset: 0,
    }).then((page) => {
      const matched = page.items.find((row: PromotionView) => {
        const id = String(row.id ?? '');
        const name = String(row.name ?? '');
        return id.toLowerCase() === code.toLowerCase() || name.toLowerCase() === code.toLowerCase();
      });

      if (!matched) {
        setAppliedPromotion(null);
        toast.error('Promotion not found or inactive for this outlet');
        return;
      }

      setAppliedPromotion(matched);
      toast.success('Promotion applied');
    }).catch((error) => {
      console.error('Promotion lookup failed:', error);
      setAppliedPromotion(null);
      toast.error('Unable to validate promotion');
    }).finally(() => {
      setPromoBusy(false);
    });
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-4 py-2.5 border-b bg-card flex items-center gap-4 flex-shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 -m-2"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-foreground font-medium">{sessionCode}</span>
          </div>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-primary font-medium inline-flex items-center gap-1"
            title="Outlet đang bán hàng"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" aria-hidden="true" />
            {outletName}
          </span>
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{cashierName}</span>
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            {customer ? (
              <button
                onClick={clearCustomer}
                aria-label="Bỏ chọn khách"
                title="Bỏ chọn khách"
                className="flex items-center gap-1 px-2 h-6 rounded-md border border-primary/40 bg-primary/5 text-[11px] text-foreground hover:bg-primary/10"
              >
                <UserPlus className="h-3 w-3 text-primary" />
                <span className="font-medium truncate max-w-[120px]">{customer.displayName ?? `Khách #${customer.id}`}</span>
                {customerAllergies.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium">{customerAllergies.length} dị ứng</span>
                )}
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            ) : (
              <button
                onClick={() => setCustomerSearchOpen((v) => !v)}
                className="flex items-center gap-1 px-2 h-6 rounded-md border border-dashed text-[11px] text-muted-foreground hover:bg-muted"
              >
                <UserPlus className="h-3 w-3" /> {t('pos.customer.add')}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5 text-success" />
          <span className="text-[10px] font-medium text-success">Online</span>
        </div>
      </div>

      {customerSearchOpen && !customer && (
        <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-2 relative">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <div className="relative flex-1">
            <Input
              autoFocus
              placeholder={t('pos.customer.search')}
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="h-7 text-xs"
              aria-label={t('pos.customer.search')}
            />
            {customerOptions.length > 0 && (
              <div
                role="listbox"
                className="absolute left-0 top-full mt-1 z-30 w-full sm:w-[320px] max-h-60 overflow-auto rounded-md border bg-card shadow-md"
              >
                {customerOptions.map((c) => (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={false}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted border-b last:border-0"
                  >
                    <div className="font-medium">{c.displayName ?? `Khách #${c.id}`}</div>
                    <div className="text-[10px] text-muted-foreground">{c.outletCode ?? ''} · {c.orderCount} đơn</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {customerSearching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="searching" />}
          <button
            aria-label={t('common.close')}
            onClick={() => { setCustomerSearchOpen(false); setCustomerSearch(''); }}
            className="text-[11px] text-muted-foreground px-1"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {allergenOverlap.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className={cn(
            'px-4 py-2.5 border-b flex items-start gap-2',
            hasSevereAllergyHit ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200',
          )}
        >
          <AlertTriangle className={cn('h-4 w-4 flex-shrink-0 mt-0.5', hasSevereAllergyHit ? 'text-red-700' : 'text-amber-700')} />
          <div className="flex-1 text-xs">
            <p className={cn('font-semibold', hasSevereAllergyHit ? 'text-red-800' : 'text-amber-800')}>
              Cảnh báo dị ứng: {customer?.displayName ?? 'khách hàng'} có {allergenOverlap.length} mục trùng allergen
            </p>
            <ul className="mt-1 space-y-0.5">
              {allergenOverlap.slice(0, 5).map((h, i) => (
                <li key={i} className="text-[11px]">
                  <span className="font-medium">{h.product}</span> ↔ {h.allergy.label}
                  <span className={cn('ml-1 px-1 rounded text-[10px] font-mono', h.allergy.severity === 'SEVERE' ? 'bg-destructive/20 text-destructive font-bold' : h.allergy.severity === 'AVOID' ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground')}>
                    {h.allergy.severity}
                  </span>
                  {h.allergy.note && <span className="ml-1 italic text-muted-foreground">— {h.allergy.note}</span>}
                </li>
              ))}
              {allergenOverlap.length > 5 && <li className="text-[10px] text-muted-foreground">+{allergenOverlap.length - 5} mục khác…</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 md:border-r pb-[64px] md:pb-0">
          <div className="p-3 border-b space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t('pos.search.products')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {categories.map((value) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={cn(
                    'text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
                    category === value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground hover:bg-accent border-border',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loadingProducts ? (
              <div className="flex items-center justify-center py-14">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    disabled={!product.available}
                    aria-disabled={!product.available}
                    className={cn(
                      'relative p-3 rounded-lg border text-left transition-all',
                      product.available
                        ? 'hover:border-primary/30 hover:shadow-surface-sm bg-card cursor-pointer'
                        : 'opacity-50 cursor-not-allowed bg-muted/30 border-dashed',
                    )}
                  >
                    {!product.available && (
                      <div aria-hidden="true" className="absolute inset-0 rounded-lg pointer-events-none bg-[repeating-linear-gradient(45deg,transparent_0_8px,rgba(220,38,38,0.04)_8px_16px)]" />
                    )}
                    <div className="flex items-start justify-between gap-1">
                      <p className={cn('text-xs font-medium leading-tight flex-1', !product.available && 'line-through text-muted-foreground')}>{product.name}</p>
                      {!product.available && (
                        <span className="px-1.5 rounded bg-destructive/10 text-destructive text-[10px] font-bold tracking-wider">86</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{product.category}</p>
                    {product.allergens && product.allergens.length > 0 ? (
                      <div className="mt-1">
                        <AllergenBadgeRow allergens={product.allergens} size="xs" />
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between mt-2">
                      <span className={cn('text-sm font-semibold', product.available ? 'text-foreground' : 'text-muted-foreground line-through')}>
                        {formatPosCurrency(product.price, resolvedCurrencyCode)}
                      </span>
                      {!product.available ? <span className="text-[10px] text-destructive font-semibold uppercase">{t('pos.product.unavailable')}</span> : null}
                    </div>
                  </button>
                ))}
                {!loadingProducts && filteredProducts.length === 0 ? (
                  <div className="col-span-full">
                    <EmptyState
                      title="Không có sản phẩm"
                      description={search ? `Không tìm thấy sản phẩm khớp với "${search}".` : 'Outlet này chưa có sản phẩm khả dụng. Mở Catalog để cấu hình.'}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:flex w-[320px] flex-col bg-card flex-shrink-0">
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4" /> {t('pos.cart.title')}
              </h3>
              <span className="text-[10px] text-muted-foreground">{cart.length} {t('pos.cart.items')}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <ShoppingBag className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">{t('pos.cart.empty')}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t('pos.cart.empty.hint')}</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {cart.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{item.productName}</p>
                      <p className="text-[10px] text-muted-foreground">{formatPosCurrency(item.unitPrice, resolvedCurrencyCode)} each</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        aria-label={`Giảm 1 ${item.productName}`}
                        onClick={() => updateQuantity(item.id, -1)}
                        className="h-9 w-9 md:h-6 md:w-6 rounded border flex items-center justify-center hover:bg-accent transition-colors text-foreground"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs font-medium w-5 text-center text-foreground">{item.quantity}</span>
                      <button
                        aria-label={`Tăng 1 ${item.productName}`}
                        onClick={() => updateQuantity(item.id, 1)}
                        className="h-9 w-9 md:h-6 md:w-6 rounded border flex items-center justify-center hover:bg-accent transition-colors text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right min-w-[50px]">
                      <p className="text-xs font-semibold text-foreground">{formatPosCurrency(item.lineTotal, resolvedCurrencyCode)}</p>
                      <button
                        aria-label={`Xóa ${item.productName}`}
                        onClick={() => removeItem(item.id)}
                        className="text-destructive hover:text-destructive/80 transition-colors p-1.5 -m-1.5"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t">
            <div className="flex gap-1.5">
              <Input
                placeholder={t('pos.promo.placeholder')}
                value={promoCode}
                onChange={(event) => {
                  setPromoCode(event.target.value);
                  setAppliedPromotion(null);
                }}
                className="h-7 text-xs flex-1"
              />
              <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={applyPromo} disabled={promoBusy || !promoCode.trim()}>
                {promoBusy ? t('common.loading') : t('pos.promo.apply')}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {appliedPromoId ? `Applied promotion: ${appliedPromoLabel}` : 'Promotion validation checks active outlet promotions.'}
            </p>
          </div>

          <div className="px-3 py-2 border-t">
            <div className="rounded-md border border-border bg-muted/20 p-2.5 text-[10px] text-muted-foreground">
              Table assignment is not exposed in current gateway contracts.
            </div>
          </div>

          <div className="px-3 py-3 border-t bg-muted/20 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('pos.cart.subtotal')}</span>
              <span>{formatPosCurrency(subtotal, resolvedCurrencyCode)}</span>
            </div>
            {appliedPromoId ? (
              <div className="flex justify-between text-xs text-success">
                <span>{t('pos.cart.discount')}</span>
                <span>-{formatPosCurrency(promoDiscount, resolvedCurrencyCode)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('pos.cart.tax')} (8%)</span>
              <span>{formatPosCurrency(taxAmount, resolvedCurrencyCode)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
              <span>{t('pos.cart.total')}</span>
              <span>{formatPosCurrency(total, resolvedCurrencyCode)}</span>
            </div>
            <Button
              className="w-full h-9 text-xs mt-2"
              disabled={cart.length === 0 || hasSevereAllergyHit}
              onClick={() => onCheckout(cart, appliedPromoId, promoDiscount)}
            >
              {hasSevereAllergyHit ? t('pos.cart.checkout.severe') : `${t('pos.cart.checkout')} — ${formatPosCurrency(total, resolvedCurrencyCode)}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom cart bar — fixed height; details open in overlay so layout stays stable */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-20">
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            disabled={cart.length === 0}
            className="flex-1 min-w-0 text-left"
            aria-label={`Xem ${cart.length} món trong giỏ`}
          >
            <div className="flex items-center gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium">{cart.length} món</span>
              <span className="text-[10px] text-muted-foreground">· {formatPosCurrency(total, resolvedCurrencyCode)}</span>
              {cart.length > 0 && <span className="text-[10px] underline text-primary ml-1">Xem</span>}
            </div>
            {appliedPromoId ? (
              <p className="text-[10px] text-success truncate">Promo: {appliedPromoLabel}</p>
            ) : null}
          </button>
          <Button
            size="sm"
            variant={hasSevereAllergyHit ? 'destructive' : 'default'}
            className="h-9 text-xs px-4 gap-1"
            disabled={cart.length === 0 || hasSevereAllergyHit}
            onClick={() => onCheckout(cart, appliedPromoId, promoDiscount)}
          >
            {hasSevereAllergyHit ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Bị chặn
              </>
            ) : (
              t('pos.cart.checkout')
            )}
          </Button>
        </div>
      </div>

      {/* Mobile cart detail overlay — separate from sticky bar so no layout shift */}
      {mobileCartOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết giỏ hàng"
          onClick={() => setMobileCartOpen(false)}
        >
          <div
            className="fixed bottom-[57px] left-0 right-0 bg-card border-t shadow-xl max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b sticky top-0 bg-card">
              <span className="text-xs font-semibold">Chi tiết giỏ ({cart.length})</span>
              <button
                aria-label={t('common.close')}
                onClick={() => setMobileCartOpen(false)}
                className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="flex-1 truncate">{item.quantity}× {item.productName}</span>
                  <span className="tabular-nums">{formatPosCurrency(item.lineTotal, resolvedCurrencyCode)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modifierTarget && (
        <ModifierPicker
          open={modifierOpen}
          onOpenChange={(open) => { setModifierOpen(open); if (!open) setModifierTarget(null); }}
          productId={modifierTarget.id}
          productName={modifierTarget.name}
          basePrice={modifierTarget.price}
          onConfirm={handleModifierConfirm}
        />
      )}
    </div>
  );
}
