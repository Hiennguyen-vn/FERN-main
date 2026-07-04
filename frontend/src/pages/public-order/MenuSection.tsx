import { useRef, useState, type RefObject } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicMenuItemView } from '@/api/fern-api';
import { Input } from '@/components/ui/input';
import type { PublicOrderCategory, PublicOrderCartDraft, PublicOrderCartLine } from '@/lib/public-order';
import { cn } from '@/lib/utils';
import { MenuItemRow } from './MenuItemRow';
import { MenuItemSheet } from './MenuItemSheet';
import { findCartLine } from './utils';

export function MenuSection({
  menuLoading,
  menuCategories,
  filteredCategories,
  searchValue,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
  categoryRefs,
  cart,
  currencyCode,
  updateCartLine,
}: {
  menuLoading: boolean;
  menuCategories: PublicOrderCategory[];
  filteredCategories: PublicOrderCategory[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string;
  onSelectCategory: (code: string) => void;
  categoryRefs: RefObject<Record<string, HTMLDivElement | null>>;
  cart: PublicOrderCartDraft;
  currencyCode: string;
  updateCartLine: (
    productId: string,
    recipe: (line: PublicOrderCartLine) => PublicOrderCartLine | null,
  ) => void;
}) {
  const [detailItem, setDetailItem] = useState<PublicMenuItemView | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);

  const openDetail = (item: PublicMenuItemView) => {
    setDetailItem(item);
    setDetailOpen(true);
  };

  const productIdOf = (item: PublicMenuItemView) => String(item.productId || '');

  const handleQuickAdd = (item: PublicMenuItemView) => {
    const productId = productIdOf(item);
    const hadItems = cart.items.length > 0;
    updateCartLine(productId, (current) => ({ ...current, quantity: current.quantity + 1 }));
    if (!hadItems) {
      toast.success('Added to your order');
    }
  };

  const visibleCategories = selectedCategory
    ? filteredCategories.filter((category) => category.code === selectedCategory)
    : filteredCategories;

  return (
    <section className="min-w-0 flex-1">
      <div
        ref={stickyRef}
        className="sticky top-[57px] z-20 -mx-1 space-y-3 rounded-xl bg-[hsl(var(--pos-bg))]/95 px-1 py-2 backdrop-blur-sm"
      >
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <Search className="h-4 w-4 shrink-0 text-[hsl(var(--pos-accent))]" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search dishes..."
            className="h-auto border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex snap-x gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            className={cn(
              'min-h-[40px] shrink-0 snap-start whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium touch-manipulation transition',
              !selectedCategory
                ? 'accent-bg border-transparent shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-[hsl(var(--pos-accent)/0.35)]',
            )}
            onClick={() => onSelectCategory('')}
          >
            All
          </button>
          {menuCategories.map((category) => (
            <button
              key={category.code}
              type="button"
              className={cn(
                'min-h-[40px] shrink-0 snap-start whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium touch-manipulation transition',
                selectedCategory === category.code
                  ? 'accent-bg border-transparent shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-[hsl(var(--pos-accent)/0.35)]',
              )}
              onClick={() => {
                onSelectCategory(category.code);
                if (!selectedCategory || selectedCategory !== category.code) {
                  categoryRefs.current?.[category.code]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2">
        {menuLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : visibleCategories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
            <p className="font-semibold text-slate-900">
              {menuCategories.length === 0 ? 'Menu is empty right now' : 'No dishes match your search'}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {menuCategories.length === 0
                ? 'Ask staff to refresh the menu.'
                : 'Try another keyword or category.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {visibleCategories.map((category) => (
              <div
                key={category.code}
                ref={(node) => {
                  if (categoryRefs.current) {
                    categoryRefs.current[category.code] = node;
                  }
                }}
              >
                {!selectedCategory ? (
                  <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                    <h3 className="text-base font-semibold text-slate-900">{category.label}</h3>
                    <span className="text-xs text-slate-500">{category.items.length} dishes</span>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {category.items.map((item) => {
                    const productId = productIdOf(item);
                    const cartLine = findCartLine(cart, productId);
                    return (
                      <MenuItemRow
                        key={productId || String(item.code)}
                        item={item}
                        currencyCode={currencyCode}
                        quantity={cartLine?.quantity || 0}
                        onOpenDetail={() => openDetail(item)}
                        onQuickAdd={() => handleQuickAdd(item)}
                        onDecrease={() => updateCartLine(productId, (current) => ({ ...current, quantity: current.quantity - 1 }))}
                        onIncrease={() => updateCartLine(productId, (current) => ({ ...current, quantity: current.quantity + 1 }))}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MenuItemSheet
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        currencyCode={currencyCode}
        initialQuantity={detailItem ? (findCartLine(cart, productIdOf(detailItem))?.quantity || 1) : 1}
        initialNote={detailItem ? (findCartLine(cart, productIdOf(detailItem))?.note || '') : ''}
        onAddToCart={(quantity, note) => {
          if (!detailItem) return;
          const productId = productIdOf(detailItem);
          updateCartLine(productId, () => ({ productId, quantity, note }));
          toast.success('Added to your order');
        }}
      />
    </section>
  );
}
