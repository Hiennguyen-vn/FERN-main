import { useCallback, useEffect, useState } from 'react';
import { Package, Search, RefreshCw, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, type ProductView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { StatusBadge } from '@/components/catalog/StatusBadge';

const CATEGORY_OPTIONS = ['beverage'];

interface ProductListPanelProps {
  token: string;
  selectedId: string | null;
  onSelect: (product: ProductView) => void;
  compact?: boolean;
  canCreate?: boolean;
}

export function ProductListPanel({ token, selectedId, onSelect, compact, canCreate = true }: ProductListPanelProps) {
  const [products, setProducts] = useState<ProductView[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ code: '', name: '', categoryCode: 'beverage' });
  const [showCreate, setShowCreate] = useState(false);

  const query = useListQueryState({ initialLimit: 25, initialSortBy: 'name', initialSortDir: 'asc' as const });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await productApi.productsPaged(token, {
        q: query.debouncedSearch || undefined, sortBy: query.sortBy, sortDir: query.sortDir,
        limit: query.limit, offset: query.offset,
      });
      setProducts(result.items);
      setTotal(result.totalCount);
      setHasMore(result.items.length >= query.limit);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load products'));
    } finally {
      setLoading(false);
    }
  }, [token, query.debouncedSearch, query.sortBy, query.sortDir, query.limit, query.offset]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error('Code and Name required'); return; }
    setBusy('create');
    try {
      const created = await productApi.createProduct(token, { code: form.code, name: form.name, categoryCode: form.categoryCode });
      setForm({ code: '', name: '', categoryCode: 'beverage' });
      setShowCreate(false);
      toast.success('Product created');
      void load();
      onSelect(created as unknown as ProductView);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to create product'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Products ({total})</h2>
        {canCreate ? (
          <button onClick={() => setShowCreate(!showCreate)}
            className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />{compact ? '' : 'Add'}
          </button>
        ) : null}
      </div>

      {/* Create form */}
      {canCreate && showCreate && (
        <div className="p-3 border-b bg-muted/30 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className="h-8 rounded-md border border-input bg-background px-2.5 text-xs" placeholder="Code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
            <input className="h-8 rounded-md border border-input bg-background px-2.5 text-xs" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={form.categoryCode} onChange={e => setForm(f => ({ ...f, categoryCode: e.target.value }))}>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => void create()} disabled={!!busy} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">
              {busy === 'create' ? '...' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="h-8 px-2 rounded-md border text-xs hover:bg-accent">Cancel</button>
          </div>
        </div>
      )}

      {/* Search + sort */}
      <div className="p-2 border-b flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs" placeholder="Search..."
            value={query.searchInput} onChange={e => query.setSearchInput(e.target.value)} />
        </div>
        <button onClick={() => void load()} disabled={loading} className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Product list */}
      <div className="flex-1 overflow-y-auto">
        {loading && products.length === 0 ? (
          <div className="flex items-center justify-center h-24"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : products.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No products found</div>
        ) : products.map(p => {
          const active = selectedId === String(p.id);
          return (
            <button key={String(p.id)} onClick={() => onSelect(p)}
              className={cn('w-full flex items-center gap-2.5 px-3 py-2.5 border-b text-left transition-colors',
                active ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30')}>
              <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {p.imageUrl ? (
                  <img
                    src={String(p.imageUrl)}
                    alt={String(p.name || '')}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                      const fallback = img.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div className={cn('h-full w-full items-center justify-center', p.imageUrl ? 'hidden' : 'flex')}>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{String(p.name || '—')}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{String(p.code || p.id)}</p>
              </div>
              <StatusBadge status={p.status} />
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="border-t p-1.5">
        <ListPaginationControls total={total} limit={query.limit} offset={query.offset} hasMore={hasMore} disabled={loading}
          onPageChange={query.setPage} onLimitChange={query.setPageSize} />
      </div>
    </div>
  );
}
