import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Package, BookOpen, DollarSign, Store, X, Loader2, Save, Edit2, Check,
  Plus, ArrowRight, AlertTriangle, MapPin, ImageIcon, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi, orgApi,
  type ProductView, type RecipeView, type PriceView, type AvailabilityView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { EmptyState } from '@/components/shell/PermissionStates';
import { StatusBadge } from '@/components/catalog/StatusBadge';
import { ScopePill } from '@/components/catalog/shared';

type DetailTab = 'identity' | 'recipe' | 'pricing' | 'availability';

interface OrgOutlet { id: string; code: string; name: string; regionId: string | number; }
interface OrgRegion { id: string; code: string; name: string; currencyCode: string; }

interface ProductDetailPanelProps {
  product: ProductView;
  token: string;
  outletId: string;
  canManageCatalog: boolean;
  onClose: () => void;
  onProductUpdated: () => void;
}

export function ProductDetailPanel({ product, token, outletId, canManageCatalog, onClose, onProductUpdated }: ProductDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('identity');
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<RecipeView | null>(null);
  const [prices, setPrices] = useState<PriceView[]>([]);
  const [allPrices, setAllPrices] = useState<PriceView[]>([]);
  const [priceFetchErrors, setPriceFetchErrors] = useState<string[]>([]);
  const [availability, setAvailability] = useState<AvailabilityView[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', status: '', imageUrl: '' });
  const [saving, setSaving] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Org data
  const [outlets, setOutlets] = useState<OrgOutlet[]>([]);
  const [regions, setRegions] = useState<OrgRegion[]>([]);

  // Item names for recipe display
  const [itemNames, setItemNames] = useState<Record<string, string>>({});

  // Refresh key to force all-prices reload after save
  const [priceRefreshKey, setPriceRefreshKey] = useState(0);

  // Set Price form
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [priceScope, setPriceScope] = useState<'outlet' | 'region'>('outlet');
  const [priceTargetOutletId, setPriceTargetOutletId] = useState('');
  const [priceTargetRegionId, setPriceTargetRegionId] = useState('');
  const [priceForm, setPriceForm] = useState({ amount: '', effectiveFrom: new Date().toISOString().slice(0, 10) });

  const pid = String(product.id);

  // Load org data + item names
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [h, items] = await Promise.all([
          orgApi.hierarchy(token),
          productApi.items(token).catch(() => [] as Array<{ id: string; name?: string | null; code?: string | null }>),
        ]);
        setOutlets(h.outlets.map((o: Record<string, unknown>) => ({
          id: String(o.id), code: String(o.code || ''), name: String(o.name || ''), regionId: String(o.regionId || ''),
        })));
        setRegions(h.regions.map((r: Record<string, unknown>) => ({
          id: String(r.id), code: String(r.code || ''), name: String(r.name || ''), currencyCode: String(r.currencyCode || 'USD'),
        })));
        const names: Record<string, string> = {};
        for (const item of items) names[String(item.id)] = String(item.name || item.code || item.id);
        setItemNames(names);
      } catch { /* optional */ }
    })();
  }, [token]);

  const outletLabel = (oid: string) => {
    const o = outlets.find(x => x.id === oid);
    return o ? `${o.code} · ${o.name}` : `Outlet ${oid}`;
  };
  const regionLabel = (rid: string) => {
    const r = regions.find(x => x.id === rid);
    return r ? `${r.code} · ${r.name}` : `Region ${rid}`;
  };
  const outletsForRegion = (rid: string) => outlets.filter(o => String(o.regionId) === rid);
  const currencyForOutlet = (oid: string) => {
    const o = outlets.find(x => x.id === oid);
    if (!o) return 'USD';
    const r = regions.find(x => x.id === String(o.regionId));
    return r?.currencyCode || 'USD';
  };

  // Load detail data
  const loadDetail = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [r, avail] = await Promise.all([
        productApi.recipe(token, pid).catch(() => null as RecipeView | null),
        productApi.availability(token, { productId: pid }).catch(() => [] as AvailabilityView[]),
      ]);
      setRecipe(r);
      setAvailability(avail);

      // Load prices at current outlet
      if (outletId) {
        const ps = await productApi.pricesPaged(token, { outletId, limit: 200, offset: 0 }).catch(() => ({ items: [] as PriceView[] }));
        const filtered = (ps.items || []).filter((p: PriceView) => String(p.productId) === pid);
        setPrices(filtered);
      }
    } finally {
      setLoading(false);
    }
  }, [token, pid, outletId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  // Load prices across all outlets (parallel, capture per-outlet errors)
  useEffect(() => {
    if (!token || outlets.length === 0) { setAllPrices([]); setPriceFetchErrors([]); return; }
    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled(outlets.map(outlet =>
        productApi.pricesPaged(token, { outletId: outlet.id, limit: 200, offset: 0 })
          .then(ps => ({ outlet, items: (ps.items || []).filter((p: PriceView) => String(p.productId) === pid) }))
      ));
      if (cancelled) return;
      const results: PriceView[] = [];
      const errors: string[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          results.push(...r.value.items.map(p => ({ ...p, outletId: r.value.outlet.id } as PriceView)));
        } else {
          errors.push(outlets[i].id);
        }
      });
      setAllPrices(results);
      setPriceFetchErrors(errors);
    })();
    return () => { cancelled = true; };
  }, [token, pid, outlets, priceRefreshKey]);

  // Edit
  const startEdit = () => {
    setEditForm({ name: String(product.name || ''), description: String(product.description || ''), status: String(product.status || 'draft'), imageUrl: String(product.imageUrl || '') });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!canManageCatalog) return;
    if (editForm.status === 'active' && product.status !== 'active') {
      const issues: string[] = [];
      if (!editForm.name?.trim()) issues.push('Product name is required');
      if (!recipe) issues.push('At least one active recipe is required');
      if (priceCount === 0) issues.push('At least one outlet price is required');
      if (priceFetchErrors.length > 0) issues.push(`Price data incomplete for ${priceFetchErrors.length} outlet(s) — refresh before activating`);
      if (issues.length > 0) { toast.error(`Cannot activate: ${issues.join('; ')}`); return; }
    }
    setSaving('product');
    try {
      await productApi.updateProduct(token, pid, { name: editForm.name || undefined, description: editForm.description || undefined, status: editForm.status || undefined, imageUrl: editForm.imageUrl?.trim() || undefined });
      toast.success('Product updated');
      setEditing(false);
      onProductUpdated();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to update')); } finally { setSaving(''); }
  };

  const handleQuickUpload = async (file: File) => {
    if (!canManageCatalog) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Unsupported format. Use JPG/PNG/WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File exceeds 5MB.');
      return;
    }
    setUploadingImage(true);
    try {
      const { uploadUrl, finalUrl } = await productApi.presignProductImageUpload(token, pid, file.type, file.size);
      await productApi.uploadProductImageToS3(uploadUrl, file);
      await productApi.updateProduct(token, pid, { imageUrl: finalUrl });
      toast.success('Image updated');
      onProductUpdated();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Upload failed'));
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImageFileSelected = async (file: File) => {
    if (!canManageCatalog) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Unsupported format. Use JPG/PNG/WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File exceeds 5MB.');
      return;
    }
    setUploadingImage(true);
    try {
      const { uploadUrl, finalUrl } = await productApi.presignProductImageUpload(token, pid, file.type, file.size);
      await productApi.uploadProductImageToS3(uploadUrl, file);
      setEditForm((f) => ({ ...f, imageUrl: finalUrl }));
      toast.success('Image uploaded. Click Save to apply.');
    } catch (e) {
      toast.error(getErrorMessage(e, 'Upload failed'));
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Set price — supports outlet or region scope
  const savePrice = async () => {
    if (!canManageCatalog) return;
    if (!priceForm.amount) return;
    setSaving('price');
    try {
      if (priceScope === 'region' && priceTargetRegionId) {
        // Fan-out: set price for all outlets in region
        const regionOutlets = outletsForRegion(priceTargetRegionId);
        if (regionOutlets.length === 0) { toast.error('No outlets in selected region'); setSaving(''); return; }
        let success = 0;
        const failed: string[] = [];
        for (const outlet of regionOutlets) {
          try {
            await productApi.upsertPrice(token, { productId: pid, outletId: outlet.id, currencyCode: currencyForOutlet(outlet.id), priceAmount: Number(priceForm.amount), effectiveFrom: priceForm.effectiveFrom });
            success++;
          } catch {
            failed.push(outletLabel(outlet.id));
          }
        }
        const rLabel = regionLabel(priceTargetRegionId);
        if (failed.length === 0) {
          toast.success(`Price set at all ${success} outlets in ${rLabel}`);
        } else if (success > 0) {
          toast.error(`Partial: ${success}/${regionOutlets.length} in ${rLabel}. Failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ` +${failed.length - 3} more` : ''}`);
        } else {
          toast.error(`Price set failed for all outlets in ${rLabel}`);
        }
      } else if (priceTargetOutletId) {
        await productApi.upsertPrice(token, { productId: pid, outletId: priceTargetOutletId, currencyCode: currencyForOutlet(priceTargetOutletId), priceAmount: Number(priceForm.amount), effectiveFrom: priceForm.effectiveFrom });
        toast.success(`Price set at ${outletLabel(priceTargetOutletId)}`);
      } else {
        toast.error('Select a target outlet or region'); setSaving(''); return;
      }
      setShowPriceForm(false);
      setPriceForm({ amount: '', effectiveFrom: new Date().toISOString().slice(0, 10) });
      setPriceRefreshKey(k => k + 1);
      void loadDetail();
      onProductUpdated();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed to set price')); } finally { setSaving(''); }
  };

  // Toggle availability
  const toggleAvailability = async (oid: string, current: boolean) => {
    if (!canManageCatalog) return;
    setSaving(`avail:${oid}`);
    try {
      await productApi.setAvailability(token, pid, oid, !current);
      toast.success(`${!current ? 'Enabled' : 'Disabled'} at ${outletLabel(oid)}`);
      void loadDetail();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setSaving(''); }
  };

  const TABS: { key: DetailTab; label: string; icon: React.ElementType }[] = canManageCatalog
    ? [
      { key: 'identity', label: 'Identity', icon: Package },
      { key: 'recipe', label: 'Recipe', icon: BookOpen },
      { key: 'pricing', label: 'Pricing', icon: DollarSign },
      { key: 'availability', label: `Outlets (${availability.filter(a => a.available).length})`, icon: Store },
    ]
    : [
      { key: 'identity', label: 'Product', icon: Package },
      { key: 'recipe', label: 'Recipe', icon: BookOpen },
      { key: 'pricing', label: 'Pricing', icon: DollarSign },
    ];

  const availCount = availability.filter(a => a.available).length;
  const priceCount = allPrices.length || prices.length;
  const pricedOutletIds = new Set(allPrices.map(p => String(p.outletId)));

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
            {canManageCatalog ? (
              <div className="border rounded-lg">
                <div className="px-3 py-2 border-b bg-muted/20">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dependencies</p>
                </div>
                <div className="divide-y">
                  <button onClick={() => setTab('recipe')} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                    <BookOpen className={cn('h-3.5 w-3.5 flex-shrink-0', !recipe ? 'text-amber-500' : 'text-emerald-500')} />
                    <span className="text-xs flex-1">Recipe</span>
                    <span className={cn('text-xs font-mono', !recipe ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{recipe ? '1/1' : '0/1'}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button onClick={() => { setTab('pricing'); if (priceCount === 0) setShowPriceForm(true); }} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                    <DollarSign className={cn('h-3.5 w-3.5 flex-shrink-0', priceCount === 0 ? 'text-amber-500' : 'text-emerald-500')} />
                    <span className="text-xs flex-1">Outlet pricing</span>
                    <span className={cn('text-xs font-mono', priceCount === 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{pricedOutletIds.size}/{outlets.length || availability.length || '—'}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button onClick={() => setTab('availability')} className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-muted/20 text-left">
                    <Store className={cn('h-3.5 w-3.5 flex-shrink-0', availCount === 0 && availability.length > 0 ? 'text-amber-500' : 'text-emerald-500')} />
                    <span className="text-xs flex-1">Availability</span>
                    <span className={cn('text-xs font-mono', availCount === 0 && availability.length > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>{availCount}/{availability.length}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                {priceCount === 0 && outlets.length > 0 ? (
                  <div className="px-3 py-2 border-t bg-amber-50/50">
                    <p className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {outlets.length} outlet pricing missing — click to set price by region or outlet
                    </p>
                  </div>
                ) : null}
                {priceFetchErrors.length > 0 ? (
                  <div className="px-3 py-2 border-t bg-amber-50/50">
                    <p className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Could not load prices for {priceFetchErrors.length} outlet(s) — data may be incomplete
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

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
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Image</label>
                  <div className="mt-1 flex items-start gap-3">
                    <div className="w-24 h-24 rounded-md border bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                      {editForm.imageUrl ? (
                        <img src={editForm.imageUrl} alt="Product" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        placeholder="Dán URL ảnh (Unsplash, CDN...)"
                        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                        value={editForm.imageUrl}
                        onChange={(e) => setEditForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      />
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleImageFileSelected(f);
                          }}
                        />
                        <button
                          type="button"
                          disabled={uploadingImage}
                          onClick={() => fileInputRef.current?.click()}
                          className="h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-60"
                        >
                          {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          {uploadingImage ? 'Đang tải...' : 'Tải ảnh lên'}
                        </button>
                        {editForm.imageUrl && (
                          <button
                            type="button"
                            onClick={() => setEditForm((f) => ({ ...f, imageUrl: '' }))}
                            className="h-8 px-3 rounded-md border text-xs text-destructive hover:bg-destructive/10"
                          >
                            Xóa ảnh
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">JPG/PNG/WEBP, tối đa 5MB.</p>
                    </div>
                  </div>
                </div>
                {editForm.status === 'active' && product.status !== 'active' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Activation requirements</p>
                    <ul className="space-y-0.5 text-[11px]">
                      <li className={editForm.name?.trim() ? 'text-emerald-600' : 'text-amber-600'}>{editForm.name?.trim() ? '✓' : '✗'} Product name</li>
                      <li className={recipe ? 'text-emerald-600' : 'text-amber-600'}>{recipe ? '✓' : '✗'} Active recipe</li>
                      <li className={priceCount > 0 ? 'text-emerald-600' : 'text-amber-600'}>{priceCount > 0 ? '✓' : '✗'} At least one outlet price</li>
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => void saveEdit()} disabled={!!saving} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Save className="h-3 w-3" />{saving ? '...' : 'Save'}</button>
                  <button onClick={() => setEditing(false)} className="h-8 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Master Data</p>
                  {canManageCatalog ? (
                    <button onClick={startEdit} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent"><Edit2 className="h-2.5 w-2.5" />Edit</button>
                  ) : null}
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-32 h-32 rounded-md border bg-muted overflow-hidden shrink-0 flex items-center justify-center relative group">
                    {product.imageUrl ? (
                      <img src={String(product.imageUrl)} alt={String(product.name || '')} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                    )}
                    {canManageCatalog && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleQuickUpload(f);
                          }}
                        />
                        <button
                          type="button"
                          disabled={uploadingImage}
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute inset-0 bg-black/50 text-white text-[11px] font-medium opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1 disabled:opacity-60"
                        >
                          {uploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                          {uploadingImage ? 'Đang tải...' : 'Tải ảnh lên'}
                        </button>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    <div><p className="text-[10px] text-muted-foreground">Code</p><p className="text-xs font-mono mt-0.5">{String(product.code || '—')}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Category</p><p className="text-xs mt-0.5">{String(product.categoryCode || '—')}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Status</p><StatusBadge status={product.status} className="mt-0.5" /></div>
                    <div><p className="text-[10px] text-muted-foreground">Recipe</p><p className="text-xs mt-0.5">{recipe?.version ? `${recipe.version} (${recipe.status})` : 'None'}</p></div>
                  </div>
                </div>
                {product.description && <div><p className="text-[10px] text-muted-foreground">Description</p><p className="text-xs mt-0.5 text-muted-foreground">{String(product.description)}</p></div>}
              </div>
            )}
          </div>

        ) : tab === 'recipe' ? (
          <div className="space-y-3">
            {!recipe ? (
              <EmptyState title="No recipe" description={canManageCatalog ? 'No recipe configured. Go to Recipes tab to create one.' : 'No recipe is configured for this product.'} />
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
                          <td className="px-3 py-1.5 text-xs">{itemNames[String(line.itemId)] || <span className="font-mono text-muted-foreground">{String(line.itemId || '—')}</span>}</td>
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
            {/* Set Price action */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Price Rules ({pricedOutletIds.size}/{outlets.length} outlets priced)
              </p>
              {canManageCatalog && !showPriceForm && (
                <button onClick={() => { setShowPriceForm(true); setPriceTargetOutletId(outletId); }}
                  className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" />Set Price
                </button>
              )}
            </div>

            {/* Scope-aware Set Price form */}
            {canManageCatalog && showPriceForm && (
              <div className="border rounded-lg p-3 space-y-3 border-l-2 border-l-primary bg-muted/10">
                <p className="text-xs font-semibold">Set Price for {String(product.name || product.code)}</p>

                {/* Scope selector */}
                <div>
                  <label className="text-[10px] text-muted-foreground">Apply to</label>
                  <div className="mt-1 flex rounded-md border overflow-hidden w-fit">
                    <button onClick={() => setPriceScope('outlet')}
                      className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors',
                        priceScope === 'outlet' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                      Single Outlet
                    </button>
                    <button onClick={() => setPriceScope('region')}
                      className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors border-l',
                        priceScope === 'region' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                      Entire Region
                    </button>
                  </div>
                </div>

                {priceScope === 'outlet' ? (
                  <div>
                    <label className="text-[10px] text-muted-foreground">Target Outlet</label>
                    <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={priceTargetOutletId} onChange={e => setPriceTargetOutletId(e.target.value)}>
                      <option value="">Select outlet...</option>
                      {outlets.map(o => (
                        <option key={o.id} value={o.id}>
                          {o.code} · {o.name} {pricedOutletIds.has(o.id) ? '(priced)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-muted-foreground">Target Region (sets price for all outlets)</label>
                    <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={priceTargetRegionId} onChange={e => setPriceTargetRegionId(e.target.value)}>
                      <option value="">Select region...</option>
                      {regions.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {r.name} ({outletsForRegion(r.id).length} outlets)
                        </option>
                      ))}
                    </select>
                    {priceTargetRegionId && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Will set price at: {outletsForRegion(priceTargetRegionId).map(o => o.code).join(', ') || 'no outlets'}
                      </p>
                    )}
                  </div>
                )}

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

                {/* Scope confirmation */}
                <div className="flex items-center gap-2 rounded-md bg-blue-50/50 border border-blue-200 p-2">
                  <MapPin className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                  <p className="text-[10px] text-blue-700">
                    {priceScope === 'region' && priceTargetRegionId
                      ? `This will set ${priceForm.amount || '—'} at ${outletsForRegion(priceTargetRegionId).length} outlets in ${regionLabel(priceTargetRegionId)}`
                      : priceTargetOutletId
                        ? `This will set ${priceForm.amount || '—'} at ${outletLabel(priceTargetOutletId)}`
                        : 'Select a target to see impact'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => void savePrice()} disabled={!priceForm.amount || !!saving}
                    className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Save className="h-3 w-3" />{saving === 'price' ? 'Saving...' : 'Save Price'}
                  </button>
                  <button onClick={() => setShowPriceForm(false)} className="h-7 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
                </div>
              </div>
            )}

            {/* Price grid: all outlets */}
            {outlets.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full"><thead><tr className="border-b bg-muted/30">
                  <th className="text-left text-[10px] px-3 py-2">Outlet</th>
                  <th className="text-right text-[10px] px-3 py-2">Price</th>
                  <th className="text-left text-[10px] px-3 py-2">Currency</th>
                  <th className="text-left text-[10px] px-3 py-2">From</th>
                  <th className="text-left text-[10px] px-3 py-2">Source</th>
                </tr></thead><tbody>
                  {outlets.map(outlet => {
                    const price = allPrices.find(p => String(p.outletId) === outlet.id);
                    return (
                      <tr key={outlet.id} className="border-b last:border-0 hover:bg-muted/10">
                        <td className="px-3 py-1.5">
                          <p className="text-xs">{outlet.code}</p>
                          <p className="text-[10px] text-muted-foreground">{outlet.name}</p>
                        </td>
                        {price ? (
                          <>
                            <td className="px-3 py-1.5 text-right text-sm font-mono font-medium">{Number(price.priceValue ?? price.priceAmount ?? 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{String(price.currencyCode || '—')}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{String(price.effectiveFrom || '—')}</td>
                            <td className="px-3 py-1.5">
                              <ScopePill level="outlet" label="outlet" />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-1.5 text-right text-xs text-muted-foreground/50">—</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground/50">—</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground/50">—</td>
                            <td className="px-3 py-1.5">
                              {canManageCatalog ? (
                                <button onClick={() => { setShowPriceForm(true); setPriceScope('outlet'); setPriceTargetOutletId(outlet.id); }}
                                  className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">
                                  <Plus className="h-2.5 w-2.5" />Set
                                </button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/50">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            ) : prices.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full"><thead><tr className="border-b bg-muted/30">
                  <th className="text-left text-[10px] px-3 py-2">Currency</th>
                  <th className="text-right text-[10px] px-3 py-2">Price</th>
                  <th className="text-left text-[10px] px-3 py-2">From</th>
                </tr></thead><tbody>
                  {prices.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 text-xs">{String(p.currencyCode || '—')}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-mono font-medium">{Number(p.priceValue ?? p.priceAmount ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{String(p.effectiveFrom || '—')}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ) : !showPriceForm ? (
              <div className="border rounded-lg p-6 text-center">
                <DollarSign className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No prices configured</p>
                {canManageCatalog ? (
                  <button onClick={() => setShowPriceForm(true)} className="mt-2 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
                    <Plus className="h-3 w-3" />Set First Price
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

        ) : tab === 'availability' ? (
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Outlets ({availCount} enabled / {availability.length} total)
              </p>
            </div>

            {availability.length === 0 ? (
              <EmptyState title="No availability data" description="No outlet availability records found." />
            ) : (
              (() => {
                // Group by region — only show outlets user can see (in their scope)
                const regionGroups: { region: OrgRegion; items: { outlet: OrgOutlet; avail: AvailabilityView; hasPriceAtOutlet: boolean }[] }[] = [];
                const availByOutlet = new Map(availability.map(a => [String(a.outletId), a]));
                const knownOutletIds = new Set(outlets.map(o => o.id));
                const usedOutletIds = new Set<string>();

                for (const region of regions) {
                  const regionOutlets = outletsForRegion(region.id);
                  const items = regionOutlets
                    .map(outlet => {
                      const avail = availByOutlet.get(outlet.id);
                      if (!avail) return null;
                      usedOutletIds.add(outlet.id);
                      return { outlet, avail, hasPriceAtOutlet: pricedOutletIds.has(outlet.id) };
                    })
                    .filter((x): x is NonNullable<typeof x> => x !== null);
                  if (items.length > 0) regionGroups.push({ region, items });
                }

                // Known outlets not yet grouped (in user scope but no region match)
                const knownOrphans = availability
                  .filter(a => !usedOutletIds.has(String(a.outletId)) && knownOutletIds.has(String(a.outletId)))
                  .map(a => {
                    const outlet = outlets.find(o => o.id === String(a.outletId));
                    if (!outlet) return null;
                    usedOutletIds.add(String(a.outletId));
                    return { outlet, avail: a, hasPriceAtOutlet: pricedOutletIds.has(String(a.outletId)) };
                  })
                  .filter((x): x is { outlet: typeof outlets[number]; avail: typeof availability[number]; hasPriceAtOutlet: boolean } => x !== null);

                // Outlets outside user scope — count only, don't show raw IDs
                const outOfScopeCount = availability.filter(a => !usedOutletIds.has(String(a.outletId))).length;
                const outOfScopeEnabled = availability.filter(a => !usedOutletIds.has(String(a.outletId)) && a.available).length;

                return (
                  <div className="space-y-2">
                    {regionGroups.map(group => {
                      const enabledInRegion = group.items.filter(i => i.avail.available).length;
                      const pricedInRegion = group.items.filter(i => i.hasPriceAtOutlet).length;
                      return (
                        <div key={group.region.id} className="border rounded-lg overflow-hidden">
                          {/* Region header */}
                          <div className="px-3 py-2 bg-muted/30 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs font-semibold">{group.region.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{group.region.code}</span>
                              <ScopePill level="region" label={group.region.currencyCode} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {enabledInRegion}/{group.items.length} enabled · {pricedInRegion}/{group.items.length} priced
                            </span>
                          </div>
                          {/* Outlet rows */}
                          <div className="divide-y">
                            {group.items.map(({ outlet, avail, hasPriceAtOutlet }) => {
                              const price = allPrices.find(p => String(p.outletId) === outlet.id);
                              return (
                                <div key={outlet.id} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/10">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium">{outlet.code}</p>
                                    <p className="text-[10px] text-muted-foreground">{outlet.name}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {/* Available */}
                                    {avail.available ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><Check className="h-2.5 w-2.5" />Enabled</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full"><X className="h-2.5 w-2.5" />Disabled</span>
                                    )}
                                    {/* Price status */}
                                    {hasPriceAtOutlet ? (
                                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-mono">
                                        {price ? Number(price.priceValue ?? price.priceAmount ?? 0).toLocaleString() : '✓'} {price?.currencyCode || ''}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">no price</span>
                                    )}
                                    {/* Toggle */}
                                    <button onClick={() => void toggleAvailability(avail.outletId, avail.available)}
                                      disabled={saving === `avail:${avail.outletId}`}
                                      className="h-6 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-60 flex-shrink-0">
                                      {saving === `avail:${avail.outletId}` ? '...' : avail.available ? 'Disable' : 'Enable'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Known outlets not grouped into a region */}
                    {knownOrphans.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-muted/30 flex items-center gap-2">
                          <Store className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground">Other outlets in scope</span>
                          <span className="text-[10px] text-muted-foreground">{knownOrphans.length} outlets</span>
                        </div>
                        <div className="divide-y">
                          {knownOrphans.map(({ outlet, avail, hasPriceAtOutlet }) => {
                            const price = allPrices.find(p => String(p.outletId) === outlet.id);
                            return (
                              <div key={outlet.id} className="px-3 py-2 flex items-center gap-3 hover:bg-muted/10">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium">{outlet.code}</p>
                                  {outlet.name && <p className="text-[10px] text-muted-foreground">{outlet.name}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                  {avail.available ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><Check className="h-2.5 w-2.5" />Enabled</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full"><X className="h-2.5 w-2.5" />Disabled</span>
                                  )}
                                  {hasPriceAtOutlet ? (
                                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-mono">
                                      {price ? Number(price.priceValue ?? price.priceAmount ?? 0).toLocaleString() : '✓'} {price?.currencyCode || ''}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">no price</span>
                                  )}
                                  <button onClick={() => void toggleAvailability(avail.outletId, avail.available)}
                                    disabled={saving === `avail:${avail.outletId}`}
                                    className="h-6 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-60 flex-shrink-0">
                                    {saving === `avail:${avail.outletId}` ? '...' : avail.available ? 'Disable' : 'Enable'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Outlets outside user scope — summary only */}
                    {outOfScopeCount > 0 && (
                      <div className="border rounded-lg p-3 bg-muted/10 flex items-center gap-2">
                        <Store className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">{outOfScopeCount} more outlets</span> outside your scope
                          ({outOfScopeEnabled} enabled)
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
