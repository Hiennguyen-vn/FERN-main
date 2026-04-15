import { useCallback, useEffect, useState } from 'react';
import {
  Package, BookOpen, DollarSign, Store, X, Loader2, Save, Edit2, Check,
  Plus, ArrowRight, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi, orgApi,
  type ProductView, type RecipeView, type PriceView, type AvailabilityView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState } from '@/components/shell/PermissionStates';
import { StatusBadge } from '@/components/catalog/StatusBadge';
import { DependencyCard, buildProductDependencies } from '@/components/catalog/shared';

type DetailTab = 'identity' | 'recipe' | 'pricing' | 'availability';

interface ProductDetailPanelProps {
  product: ProductView;
  token: string;
  outletId: string;
  onClose: () => void;
  onProductUpdated: () => void;
}

export function ProductDetailPanel({ product, token, outletId, onClose, onProductUpdated }: ProductDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('identity');
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [prices, setPrices] = useState<PriceView[]>([]);
  const [availability, setAvailability] = useState<AvailabilityView[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', status: '' });
  const [saving, setSaving] = useState('');

  // Outlet names
  const [outletNames, setOutletNames] = useState<Record<string, string>>({});

  // Set Price form
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [priceForm, setPriceForm] = useState({ amount: '', effectiveFrom: new Date().toISOString().slice(0, 10) });

  const pid = String(product.id);

  // Load detail data
  const loadDetail = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [r, avail] = await Promise.all([
        productApi.recipe(token, pid).catch(() => null),
        productApi.availability(token, { productId: pid }).catch(() => []),
      ]);
      setRecipe(r);
      setAvailability(avail);
      if (outletId) {
        const ps = await productApi.prices(token, outletId).catch(() => []);
        setPrices(ps.filter((p: PriceView) => String(p.productId) === pid));
      }
    } finally {
      setLoading(false);
    }
  }, [token, pid, outletId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  // Load outlet names for display
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const hierarchy = await orgApi.hierarchy(token);
        const names: Record<string, string> = {};
        for (const outlet of hierarchy.outlets) {
          names[String(outlet.id)] = `${outlet.code || ''} · ${outlet.name || ''}`.trim();
        }
        setOutletNames(names);
      } catch { /* optional */ }
    })();
  }, [token]);

  const outletLabel = (oid: string) => outletNames[oid] || `Outlet ${oid}`;

  // Edit product
  const startEdit = () => {
    setEditForm({ name: String(product.name || ''), description: String(product.description || ''), status: String(product.status || 'draft') });
    setEditing(true);
  };

  const saveEdit = async () => {
    // §H — Product lifecycle enforcement: validate before activating
    if (editForm.status === 'active' && product.status !== 'active') {
      const issues: string[] = [];
      if (!editForm.name?.trim()) issues.push('Product name is required');
      if (!recipe) issues.push('At least one active recipe is required');
      if (priceCount === 0) issues.push('At least one outlet price is required');
      if (issues.length > 0) {
        toast.error(`Cannot activate: ${issues.join('; ')}`);
        return;
      }
    }
    setSaving('product');
    try {
      await productApi.updateProduct(token, pid, {
        name: editForm.name || undefined,
        description: editForm.description || undefined,
        status: editForm.status || undefined,
      });
      toast.success('Product updated');
      setEditing(false);
      onProductUpdated();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to update'));
    } finally {
      setSaving('');
    }
  };

  // Set price at current outlet
  const savePrice = async () => {
    if (!outletId || !priceForm.amount) return;
    setSaving('price');
    try {
      await productApi.upsertPrice(token, {
        productId: pid,
        outletId,
        priceAmount: Number(priceForm.amount),
        effectiveFrom: priceForm.effectiveFrom,
      });
      toast.success(`Price set at ${outletLabel(outletId)}`);
      setShowPriceForm(false);
      setPriceForm({ amount: '', effectiveFrom: new Date().toISOString().slice(0, 10) });
      void loadDetail();
      onProductUpdated();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to set price'));
    } finally {
      setSaving('');
    }
  };

  // Toggle availability
  const toggleAvailability = async (oid: string, current: boolean) => {
    setSaving(`avail:${oid}`);
    try {
      await productApi.setAvailability(token, pid, oid, !current);
      toast.success(`${!current ? 'Enabled' : 'Disabled'} at outlet`);
      void loadDetail();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to update availability'));
    } finally {
      setSaving('');
    }
  };

  const TABS: { key: DetailTab; label: string; icon: React.ElementType }[] = [
    { key: 'identity', label: 'Identity', icon: Package },
    { key: 'recipe', label: 'Recipe', icon: BookOpen },
    { key: 'pricing', label: 'Pricing', icon: DollarSign },
    { key: 'availability', label: `Outlets (${availability.filter(a => a.available).length})`, icon: Store },
  ];

  const availCount = availability.filter(a => a.available).length;
  const priceCount = prices.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3 bg-card/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{String(product.name || '—')}</h3>
            <p className="text-[10px] text-muted-foreground font-mono">{String(product.code || product.id)} · {String(product.categoryCode || '—')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusBadge status={product.status} />
          <button onClick={onClose} className="h-7 w-7 rounded hover:bg-accent flex items-center justify-center text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-4 flex items-center gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-1 px-2.5 py-2 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap',
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-3 w-3" />{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : tab === 'identity' ? (
          <div className="space-y-4">
            {/* Dependencies — clickable to jump to relevant tab */}
            <div className="border rounded-lg">
              <div className="px-3 py-2 border-b bg-muted/20">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dependencies</p>
              </div>
              <div className="divide-y">
                <button onClick={() => setTab('recipe')} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                  <BookOpen className={cn('h-3.5 w-3.5 flex-shrink-0', !recipe ? 'text-amber-500' : 'text-muted-foreground')} />
                  <span className="text-xs flex-1">Recipe</span>
                  <span className={cn('text-xs font-mono', !recipe ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{recipe ? '1/1' : '0/1'}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </button>
                <button onClick={() => { setTab('pricing'); if (priceCount === 0) setShowPriceForm(true); }} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                  <DollarSign className={cn('h-3.5 w-3.5 flex-shrink-0', priceCount === 0 ? 'text-amber-500' : 'text-muted-foreground')} />
                  <span className="text-xs flex-1">Outlet pricing</span>
                  <span className={cn('text-xs font-mono', priceCount === 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{priceCount}/{availability.length || '—'}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </button>
                <button onClick={() => setTab('availability')} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                  <Store className={cn('h-3.5 w-3.5 flex-shrink-0', availCount === 0 && availability.length > 0 ? 'text-amber-500' : 'text-muted-foreground')} />
                  <span className="text-xs flex-1">Availability</span>
                  <span className={cn('text-xs font-mono', availCount === 0 && availability.length > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{availCount}/{availability.length}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
              {(priceCount === 0 && availability.length > 0) && (
                <div className="px-3 py-2 border-t bg-amber-50/50">
                  <p className="text-[10px] text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {availability.length - priceCount} outlet pricing missing
                  </p>
                </div>
              )}
            </div>

            {/* Product info */}
            {editing ? (
              <div className="space-y-3 border rounded-lg p-3">
                <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</label>
                  <input className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</label>
                  <textarea className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm resize-none" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} /></div>
                <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</label>
                  <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="draft">draft</option><option value="active">active</option><option value="inactive">inactive</option><option value="discontinued">discontinued</option>
                  </select></div>
                {editForm.status === 'active' && product.status !== 'active' && (
                  <div className="col-span-full rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Activation requirements</p>
                    <ul className="space-y-0.5 text-[11px]">
                      <li className={editForm.name?.trim() ? 'text-emerald-600' : 'text-amber-600'}>
                        {editForm.name?.trim() ? '✓' : '✗'} Product name
                      </li>
                      <li className={recipe ? 'text-emerald-600' : 'text-amber-600'}>
                        {recipe ? '✓' : '✗'} Active recipe
                      </li>
                      <li className={priceCount > 0 ? 'text-emerald-600' : 'text-amber-600'}>
                        {priceCount > 0 ? '✓' : '✗'} At least one outlet price
                      </li>
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => void saveEdit()} disabled={!!saving} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Save className="h-3 w-3" />{saving ? '...' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)} className="h-8 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Master Data</p>
                  <button onClick={startEdit} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent"><Edit2 className="h-2.5 w-2.5" />Edit</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-[10px] text-muted-foreground">Code</p><p className="text-xs font-mono mt-0.5">{String(product.code || '—')}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Category</p><p className="text-xs mt-0.5">{String(product.categoryCode || '—')}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Status</p><StatusBadge status={product.status} className="mt-0.5" /></div>
                  <div><p className="text-[10px] text-muted-foreground">Recipe</p><p className="text-xs mt-0.5">{recipe?.version ? `${recipe.version} (${recipe.status})` : 'None'}</p></div>
                </div>
                {product.description && <div><p className="text-[10px] text-muted-foreground">Description</p><p className="text-xs mt-0.5 text-muted-foreground">{String(product.description)}</p></div>}
              </div>
            )}
          </div>
        ) : tab === 'recipe' ? (
          <div className="space-y-3">
            {!recipe ? (
              <EmptyState title="No recipe" description="No recipe configured. Go to Recipes tab to create one." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-[10px] text-muted-foreground">Version</p><p className="text-xs mt-0.5">{String(recipe.version || '—')}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Yield</p><p className="text-xs mt-0.5">{recipe.yieldQty} {recipe.yieldUomCode}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Status</p><StatusBadge status={recipe.status} className="mt-0.5" /></div>
                </div>
                {recipe.items && recipe.items.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full"><thead><tr className="border-b bg-muted/30">
                      <th className="text-left text-[10px] px-3 py-2">Ingredient</th>
                      <th className="text-right text-[10px] px-3 py-2">Qty</th>
                      <th className="text-left text-[10px] px-3 py-2">UOM</th>
                    </tr></thead><tbody>
                      {recipe.items.map((line, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5 text-xs font-mono">{String(line.itemId || '—')}</td>
                          <td className="px-3 py-1.5 text-right text-xs">{Number(line.qtyRequired ?? line.qty ?? 0).toFixed(3)}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{String(line.uomCode || '—')}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                )}
              </>
            )}
          </div>
        ) : tab === 'pricing' ? (
          <div className="space-y-3">
            {!outletId ? (
              <EmptyState title="Outlet required" description="Select an outlet from the scope bar to set pricing." />
            ) : (
              <>
                {/* Current outlet context */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{outletLabel(outletId)}</span>
                  </div>
                  {!showPriceForm && (
                    <button onClick={() => setShowPriceForm(true)} className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
                      <Plus className="h-3 w-3" />Set Price
                    </button>
                  )}
                </div>

                {/* Set Price form */}
                {showPriceForm && (
                  <div className="border rounded-lg p-3 space-y-2 border-l-2 border-l-primary bg-muted/10">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Set price at {outletLabel(outletId)}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Price Amount</label>
                        <input type="number" min="0" step="0.01" className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm font-mono"
                          placeholder="0.00" value={priceForm.amount} onChange={e => setPriceForm(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Effective From</label>
                        <input type="date" className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                          value={priceForm.effectiveFrom} onChange={e => setPriceForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void savePrice()} disabled={!priceForm.amount || !!saving}
                        className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                        <Save className="h-3 w-3" />{saving === 'price' ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setShowPriceForm(false)} className="h-7 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Price list */}
                {prices.length === 0 && !showPriceForm ? (
                  <div className="border rounded-lg p-6 text-center">
                    <DollarSign className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No price set at this outlet</p>
                    <button onClick={() => setShowPriceForm(true)} className="mt-2 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
                      <Plus className="h-3 w-3" />Set First Price
                    </button>
                  </div>
                ) : prices.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full"><thead><tr className="border-b bg-muted/30">
                      <th className="text-left text-[10px] px-3 py-2">Currency</th>
                      <th className="text-right text-[10px] px-3 py-2">Price</th>
                      <th className="text-left text-[10px] px-3 py-2">From</th>
                    </tr></thead><tbody>
                      {prices.map((p, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5 text-xs">{String(p.currencyCode || '—')}</td>
                          <td className="px-3 py-1.5 text-right text-sm font-mono font-medium">{Number(p.priceValue ?? p.priceAmount ?? 0).toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{String(p.effectiveFrom || '—')}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                )}
              </>
            )}
          </div>
        ) : tab === 'availability' ? (
          <div className="space-y-3">
            {availability.length === 0 ? (
              <EmptyState title="No availability data" description="No outlet availability records found." />
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full"><thead><tr className="border-b bg-muted/30">
                  <th className="text-left text-[10px] px-3 py-2">Outlet</th>
                  <th className="text-center text-[10px] px-3 py-2">Available</th>
                  <th className="text-right text-[10px] px-3 py-2"></th>
                </tr></thead><tbody>
                  {availability.map(a => (
                    <tr key={a.outletId} className="border-b last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3 w-3 text-muted-foreground" />
                          <div>
                            <span className="text-xs">{outletLabel(String(a.outletId))}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {a.available ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><Check className="h-2.5 w-2.5" />Enabled</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full"><X className="h-2.5 w-2.5" />Disabled</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => void toggleAvailability(a.outletId, a.available)}
                          disabled={saving === `avail:${a.outletId}`}
                          className="h-6 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-60"
                        >
                          {saving === `avail:${a.outletId}` ? '...' : a.available ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
