import { useRef } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import type { PublicMenuItemView } from '@/api/fern-api';
import type { PublicOrderCartDraft, PublicOrderCartLine, PublicOrderCategory } from '@/lib/public-order';
import { formatPublicLabel } from '@/lib/public-order';
import { formatPublicCurrency, productDisplayName, productInitials } from './public-order-format';
import { useCategoryScrollSync } from './use-category-scroll-sync';

function findCartLine(draft: PublicOrderCartDraft, productId: string) {
  return draft.items.find((item) => item.productId === productId) ?? null;
}

function ProductRow({
  item,
  currencyCode,
  cartLine,
  onAdjust,
}: {
  item: PublicMenuItemView;
  currencyCode: string;
  cartLine: PublicOrderCartLine | null;
  onAdjust: (productId: string, delta: number) => void;
}) {
  const productId = String(item.productId || '');
  const name = productDisplayName(item);
  const qty = cartLine?.quantity || 0;

  return (
    <article
      className={`po-product-row${qty > 0 ? ' has-qty' : ''}`}
      data-testid={`public-menu-item-${productId}`}
    >
      <div className="po-product-thumb">
        {item.imageUrl ? (
          <img src={String(item.imageUrl)} alt={name} loading="lazy" />
        ) : (
          <div className="po-product-thumb-fallback">{productInitials(name)}</div>
        )}
      </div>

      <div className="po-product-info">
        <p className="po-product-name">{name}</p>
        <p className="po-product-price">{formatPublicCurrency(item.priceValue, currencyCode)}</p>
        {item.description ? (
          <p className="po-product-desc">{String(item.description)}</p>
        ) : null}
      </div>

      {qty > 0 ? (
        <div className="po-stepper" role="group" aria-label={`Số lượng ${name}`}>
          <button
            type="button"
            className="po-stepper-btn"
            onClick={() => onAdjust(productId, -1)}
            aria-label={`Giảm ${name}`}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="po-stepper-qty">{qty}</span>
          <button
            type="button"
            className="po-stepper-btn"
            onClick={() => onAdjust(productId, 1)}
            aria-label={`Tăng ${name}`}
            data-testid={`add-to-cart-${productId}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="po-add-btn"
          onClick={() => onAdjust(productId, 1)}
          aria-label={`Thêm ${name}`}
          data-testid={`add-to-cart-${productId}`}
        >
          <Plus className="h-5 w-5" />
        </button>
      )}
    </article>
  );
}

export function PublicMenuBrowser({
  categories,
  filteredCategories,
  cart,
  currencyCode,
  loading,
  searchActive,
  onAdjustQuantity,
}: {
  categories: PublicOrderCategory[];
  filteredCategories: PublicOrderCategory[];
  cart: PublicOrderCartDraft;
  currencyCode: string;
  loading: boolean;
  searchActive: boolean;
  onAdjustQuantity: (productId: string, delta: number) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const { activeCategory, scrollToCategory, setSectionRef } = useCategoryScrollSync(
    filteredCategories,
    paneRef,
  );

  const showRail = !searchActive && filteredCategories.length > 1;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (filteredCategories.length === 0) {
    return (
      <div className="mx-4 my-8 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
        <p className="text-base font-semibold text-slate-900">
          {categories.length === 0 ? 'Chưa có món trong thực đơn' : 'Không tìm thấy món phù hợp'}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {categories.length === 0
            ? 'Vui lòng nhờ nhân viên kiểm tra thực đơn cửa hàng.'
            : 'Thử từ khóa khác hoặc chọn nhóm món bên trái.'}
        </p>
      </div>
    );
  }

  return (
    <div className="po-menu-layout">
      {showRail ? (
        <nav className="po-category-rail" aria-label="Nhóm món">
          {filteredCategories.map((category) => (
            <button
              key={category.code}
              type="button"
              className={`po-category-btn${activeCategory === category.code ? ' is-active' : ''}`}
              onClick={() => scrollToCategory(category.code)}
              aria-current={activeCategory === category.code ? 'true' : undefined}
            >
              <span className="po-category-dot" aria-hidden />
              <span>{category.label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div ref={paneRef} className="po-product-pane">
        {filteredCategories.map((category) => (
          <section
            key={category.code}
            data-category-code={category.code}
            ref={(node) => setSectionRef(category.code, node)}
          >
            <div className="po-section-header">
              <h3 className="po-section-title">{category.label}</h3>
              <span className="po-section-count">{category.items.length} món</span>
            </div>
            <div className="po-section-divider" aria-hidden />
            {category.items.map((item) => {
              const productId = String(item.productId || '');
              return (
                <ProductRow
                  key={productId || String(item.code)}
                  item={item}
                  currencyCode={currencyCode}
                  cartLine={findCartLine(cart, productId)}
                  onAdjust={onAdjustQuantity}
                />
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

export { formatPublicLabel };
