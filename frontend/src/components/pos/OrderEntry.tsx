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
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { normalizeNumericId } from '@/constants/pos';
import { calculatePromotionDiscount } from '@/components/pos/promotion-utils';
import { toast } from 'sonner';

type CartItem = OrderLineItem;

interface Props {
  sessionCode: string;
  outletName: string;
  cashierName: string;
  onBack: () => void;
  onCheckout: (items: CartItem[], promo: string | null, promoDiscount: number) => void;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function OrderEntry({ sessionCode, outletName, cashierName, onBack, onCheckout }: Props) {
  const { token, scope } = useShellRuntime();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [appliedPromotion, setAppliedPromotion] = useState<PromotionView | null>(null);

  const scopedOutletId = normalizeNumericId(scope.outletId);

  useEffect(() => {
    const loadProducts = async () => {
      if (!token) {
        setProducts([]);
        setLoadingProducts(false);
        return;
      }

      setLoadingProducts(true);
      try {
        const [rawProducts, rawPrices] = await Promise.all([
          productApi.products(token),
          scopedOutletId ? productApi.prices(token, scopedOutletId) : Promise.resolve([]),
        ]);

        const priceByProductId = new Map<string, number>();
        rawPrices.forEach((price: PriceView) => {
          priceByProductId.set(String(price.productId), toNumber(price.priceValue));
        });

        const mapped: ProductItem[] = rawProducts.map((product: ProductView) => {
          const productId = String(product.id);
          return {
            id: productId,
            name: String(product.name ?? `Product ${productId}`),
            category: String(product.categoryCode ?? 'Uncategorized'),
            price: priceByProductId.get(productId) ?? 0,
            sku: String(product.code ?? productId),
            available: String(product.status ?? 'active').toLowerCase() === 'active',
          };
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

  const addToCart = (product: ProductItem) => {
    if (!product.available) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id
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
          unitPrice: product.price,
          lineTotal: product.price,
        },
      ];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + delta, lineTotal: (item.quantity + delta) * item.unitPrice }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const removeItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
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
  const taxAmount = +(adjustedSubtotal * taxRate).toFixed(2);
  const total = +(adjustedSubtotal + taxAmount).toFixed(2);

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
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-foreground font-medium">{sessionCode}</span>
          </div>
          <span className="text-xs text-muted-foreground">{outletName}</span>
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{cashierName}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5 text-success" />
          <span className="text-[10px] font-medium text-success">Online</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 border-r">
          <div className="p-3 border-b space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search products…"
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
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all',
                      product.available
                        ? 'hover:border-primary/30 hover:shadow-surface-sm bg-card cursor-pointer'
                        : 'opacity-40 cursor-not-allowed bg-muted/30',
                    )}
                  >
                    <p className="text-xs font-medium text-foreground leading-tight">{product.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{product.category}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-semibold text-foreground">${product.price.toFixed(2)}</span>
                      {!product.available ? <span className="text-[9px] text-destructive font-medium">Unavailable</span> : null}
                    </div>
                  </button>
                ))}
                {!loadingProducts && filteredProducts.length === 0 ? (
                  <div className="col-span-full text-center py-10 text-sm text-muted-foreground">
                    No products available for this outlet.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="w-[320px] flex flex-col bg-card flex-shrink-0">
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4" /> Current Order
              </h3>
              <span className="text-[10px] text-muted-foreground">{cart.length} items</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <ShoppingBag className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No items added</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tap a product to add it to the order</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {cart.map((item) => (
                  <div key={item.productId} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{item.productName}</p>
                      <p className="text-[10px] text-muted-foreground">${item.unitPrice.toFixed(2)} each</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updateQuantity(item.productId, -1)} className="h-6 w-6 rounded border flex items-center justify-center hover:bg-accent transition-colors text-foreground">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs font-medium w-5 text-center text-foreground">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.productId, 1)} className="h-6 w-6 rounded border flex items-center justify-center hover:bg-accent transition-colors text-foreground">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right min-w-[50px]">
                      <p className="text-xs font-semibold text-foreground">${item.lineTotal.toFixed(2)}</p>
                      <button onClick={() => removeItem(item.productId)} className="text-destructive hover:text-destructive/80 transition-colors">
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
                placeholder="Promo code"
                value={promoCode}
                onChange={(event) => {
                  setPromoCode(event.target.value);
                  setAppliedPromotion(null);
                }}
                className="h-7 text-xs flex-1"
              />
              <Button variant="outline" size="sm" className="h-7 text-[10px] px-2" onClick={applyPromo} disabled={promoBusy || !promoCode.trim()}>
                {promoBusy ? 'Checking...' : 'Apply'}
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
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {appliedPromoId ? (
              <div className="flex justify-between text-xs text-success">
                <span>Discount</span>
                <span>-${promoDiscount.toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tax (8%)</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
              <span>Total</span>
              <span>${total > 0 ? total.toFixed(2) : '0.00'}</span>
            </div>
            <Button
              className="w-full h-9 text-xs mt-2"
              disabled={cart.length === 0}
              onClick={() => onCheckout(cart, appliedPromoId, promoDiscount)}
            >
              Proceed to Payment — ${total > 0 ? total.toFixed(2) : '0.00'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
