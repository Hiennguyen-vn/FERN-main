import { useEffect, useState } from 'react';
import {
  X, Leaf, BookOpen, Warehouse, Loader2, Edit2, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, type ItemView, type RecipeView, type ProductView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { StatusBadge } from '@/components/catalog/StatusBadge';

interface RecipeUsage {
  product: ProductView;
  recipe: RecipeView;
  qty: number;
  uom: string;
}

interface IngredientDrawerProps {
  item: ItemView;
  token: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function IngredientDrawer({ item, token, onClose, onUpdated }: IngredientDrawerProps) {
  const [usages, setUsages] = useState<RecipeUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', minStockLevel: '', maxStockLevel: '', status: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const products = await productApi.products(token);
        const results: RecipeUsage[] = [];
        for (const product of products) {
          try {
            const recipe = await productApi.recipe(token, String(product.id));
            if (recipe?.items) {
              for (const line of recipe.items) {
                if (String(line.itemId) === String(item.id)) {
                  results.push({
                    product,
                    recipe,
                    qty: Number(line.qtyRequired ?? (line as Record<string, unknown>).qty ?? 0),
                    uom: String(line.uomCode || '—'),
                  });
                }
              }
            }
          } catch { /* no recipe */ }
        }
        if (!cancelled) setUsages(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, item.id]);

  const startEdit = () => {
    setForm({
      name: String(item.name || ''),
      minStockLevel: String(item.minStockLevel ?? ''),
      maxStockLevel: String(item.maxStockLevel ?? ''),
      status: String(item.status || 'active'),
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await productApi.updateItem(token, String(item.id), {
        name: form.name || undefined,
        minStockLevel: form.minStockLevel ? Number(form.minStockLevel) : undefined,
        maxStockLevel: form.maxStockLevel ? Number(form.maxStockLevel) : undefined,
        status: form.status || undefined,
      });
      toast.success('Ingredient updated');
      setEditing(false);
      onUpdated();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to update'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-foreground/20 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[420px] max-w-[90vw] bg-card border-l shadow-xl z-50 flex flex-col animate-fade-in">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <Leaf className="h-4 w-4 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{String(item.name || '—')}</h3>
              <p className="text-[10px] text-muted-foreground font-mono">{String(item.code || item.id)} · {String(item.baseUomCode || item.unitCode || '—')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusBadge status={item.status} />
            <button onClick={onClose} className="h-7 w-7 rounded hover:bg-accent flex items-center justify-center text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Properties */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Properties</p>
              {!editing && (
                <button onClick={startEdit} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent">
                  <Edit2 className="h-2.5 w-2.5" />Edit
                </button>
              )}
            </div>
            {editing ? (
              <div className="space-y-2 border rounded-lg p-3">
                <div><label className="text-[10px] text-muted-foreground">Name</label>
                  <input className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">Min Stock</label>
                    <input type="number" className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm" value={form.minStockLevel} onChange={e => setForm(f => ({ ...f, minStockLevel: e.target.value }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Max Stock</label>
                    <input type="number" className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm" value={form.maxStockLevel} onChange={e => setForm(f => ({ ...f, maxStockLevel: e.target.value }))} /></div>
                </div>
                <div><label className="text-[10px] text-muted-foreground">Status</label>
                  <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="active">active</option><option value="inactive">inactive</option><option value="discontinued">discontinued</option>
                  </select></div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => void saveEdit()} disabled={saving} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1 disabled:opacity-60"><Save className="h-3 w-3" />{saving ? '...' : 'Save'}</button>
                  <button onClick={() => setEditing(false)} className="h-7 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[10px] text-muted-foreground">Base UOM</p><p className="text-xs mt-0.5">{String(item.baseUomCode || item.unitCode || '—')}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Category</p><p className="text-xs mt-0.5">{String(item.categoryCode || '—')}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Min Stock</p><p className="text-xs mt-0.5">{item.minStockLevel != null ? Number(item.minStockLevel).toFixed(2) : '—'}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Max Stock</p><p className="text-xs mt-0.5">{item.maxStockLevel != null ? Number(item.maxStockLevel).toFixed(2) : '—'}</p></div>
              </div>
            )}
          </div>

          {/* Recipe usage */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Used in Recipes ({usages.length})</p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : usages.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">Not used in any recipes</p>
            ) : (
              <div className="border rounded-lg divide-y">
                {usages.map((u, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium">{String(u.product.name || u.product.code)}</p>
                      <p className="text-[10px] text-muted-foreground">{u.recipe.version} · <StatusBadge status={u.recipe.status} /></p>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">{u.qty.toFixed(3)} {u.uom}</p>
                  </div>
                ))}
              </div>
            )}
            {usages.length > 0 && (
              <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                <span>Changing this ingredient affects {usages.length} active recipe{usages.length > 1 ? 's' : ''}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
