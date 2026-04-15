import { useCallback, useEffect, useState } from 'react';
import {
  LayoutGrid, Plus, ChevronDown, ChevronRight, Trash2, Save, RefreshCw,
  Loader2, X, Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi,
  type MenuView, type MenuCategoryView, type ProductView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { StatusBadge } from '@/components/catalog/StatusBadge';
import { ScopePill } from '@/components/catalog/shared';

interface MenuAssignmentProps {
  token: string;
}

export function MenuAssignment({ token }: MenuAssignmentProps) {
  const [menus, setMenus] = useState<MenuView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<MenuView | null>(null);
  const [products, setProducts] = useState<ProductView[]>([]);

  // Create menu form
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ code: '', name: '', description: '', scopeType: 'corporate' });

  // Add category form
  const [addingCategory, setAddingCategory] = useState(false);
  const [catForm, setCatForm] = useState({ code: '', name: '' });

  // Add item state
  const [addingToCatId, setAddingToCatId] = useState<string | null>(null);
  const [addItemProductId, setAddItemProductId] = useState('');

  // Expanded categories
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState('');

  const loadMenus = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [m, p] = await Promise.all([productApi.menus(token), productApi.products(token)]);
      setMenus(m);
      setProducts(p);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load menus'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadMenus(); }, [loadMenus]);

  // When selected menu changes, reload detail
  useEffect(() => {
    if (!selectedMenuId || !token) { setSelectedMenu(null); return; }
    (async () => {
      try {
        const m = await productApi.menu(token, selectedMenuId);
        setSelectedMenu(m);
        // Expand all categories by default
        setExpandedCats(new Set((m.categories || []).map(c => String(c.id))));
      } catch {
        setSelectedMenu(null);
      }
    })();
  }, [selectedMenuId, token, menus]);

  const handleCreateMenu = async () => {
    if (!createForm.code.trim() || !createForm.name.trim()) { toast.error('Code and Name required'); return; }
    setBusy('create-menu');
    try {
      const m = await productApi.createMenu(token, createForm);
      toast.success('Menu created');
      setCreating(false);
      setCreateForm({ code: '', name: '', description: '', scopeType: 'corporate' });
      void loadMenus();
      setSelectedMenuId(String(m.id));
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedMenuId) return;
    setBusy('update-status');
    try {
      await productApi.updateMenu(token, selectedMenuId, { status });
      toast.success(`Menu ${status}`);
      void loadMenus();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleAddCategory = async () => {
    if (!selectedMenuId || !catForm.code.trim() || !catForm.name.trim()) { toast.error('Code and Name required'); return; }
    setBusy('add-cat');
    try {
      const nextOrder = (selectedMenu?.categories?.length || 0) + 1;
      await productApi.addMenuCategory(token, selectedMenuId, { ...catForm, displayOrder: nextOrder });
      toast.success('Category added');
      setAddingCategory(false);
      setCatForm({ code: '', name: '' });
      void loadMenus();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleAddItem = async (categoryId: string) => {
    if (!addItemProductId) return;
    setBusy(`add-item:${categoryId}`);
    try {
      const cat = selectedMenu?.categories?.find(c => String(c.id) === categoryId);
      const nextOrder = (cat?.items?.length || 0) + 1;
      await productApi.addMenuItem(token, categoryId, { productId: addItemProductId, displayOrder: nextOrder });
      toast.success('Product added to menu');
      setAddingToCatId(null);
      setAddItemProductId('');
      void loadMenus();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const handleRemoveItem = async (itemId: string) => {
    setBusy(`rm:${itemId}`);
    try {
      await productApi.removeMenuItem(token, itemId);
      toast.success('Removed');
      void loadMenus();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const toggleCat = (catId: string) => setExpandedCats(prev => {
    const next = new Set(prev);
    if (next.has(catId)) {
      next.delete(catId);
    } else {
      next.add(catId);
    }
    return next;
  });

  // Products not yet in selected menu
  const assignedProductIds = new Set(
    (selectedMenu?.categories || []).flatMap(c => (c.items || []).map(i => String(i.productId)))
  );
  const availableProducts = products.filter(p => !assignedProductIds.has(String(p.id)));

  const totalItems = (selectedMenu?.categories || []).reduce((sum, c) => sum + (c.items?.length || 0), 0);

  return (
    <div className="flex h-full animate-fade-in">
      {/* ── Left: Menu list ─────────────────────────────── */}
      <div className="w-full sm:w-64 md:w-72 border-r flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />Menus
          </h3>
          <div className="flex items-center gap-1">
            <button onClick={() => void loadMenus()} disabled={loading} className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            </button>
            <button onClick={() => setCreating(true)} className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {creating && (
          <div className="px-3 py-3 border-b space-y-2 bg-muted/20">
            <input className="h-7 w-full rounded border border-input bg-background px-2 text-xs font-mono" placeholder="CODE" value={createForm.code} onChange={e => setCreateForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
            <input className="h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="Menu Name" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
            <select className="h-7 w-full rounded border border-input bg-background px-1 text-xs" value={createForm.scopeType} onChange={e => setCreateForm(f => ({ ...f, scopeType: e.target.value }))}>
              <option value="corporate">Corporate</option><option value="region">Region</option><option value="outlet">Outlet</option>
            </select>
            <div className="flex gap-1">
              <button onClick={() => void handleCreateMenu()} disabled={!!busy} className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">Create</button>
              <button onClick={() => setCreating(false)} className="h-6 px-2 rounded border text-[10px]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && menus.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : menus.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">No menus yet</p>
          ) : menus.map(m => (
            <button
              key={String(m.id)}
              onClick={() => setSelectedMenuId(String(m.id))}
              className={cn(
                'w-full px-4 py-2.5 text-left border-b hover:bg-muted/20 transition-colors',
                selectedMenuId === String(m.id) && 'bg-primary/5 border-l-2 border-l-primary',
              )}
            >
              <p className="text-xs font-medium">{m.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <StatusBadge status={m.status} />
                <ScopePill level={m.scopeType as 'corporate' | 'region' | 'outlet'} label={m.scopeType} />
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {(m.categories || []).reduce((s, c) => s + (c.items?.length || 0), 0)} items
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: Menu detail ──────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedMenu ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <LayoutGrid className="h-8 w-8 mx-auto opacity-20" />
              <p className="text-xs">{menus.length === 0 ? 'No menus yet' : 'Select a menu'}</p>
              {menus.length === 0 && (
                <button onClick={() => setCreating(true)} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" />Create your first menu
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b flex items-start justify-between gap-3 bg-card/50">
              <div>
                <h3 className="text-sm font-semibold">{selectedMenu.name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground">{selectedMenu.code}</span>
                  <StatusBadge status={selectedMenu.status} />
                  <ScopePill level={selectedMenu.scopeType as 'corporate' | 'region' | 'outlet'} label={selectedMenu.scopeType} />
                  <span className="text-[10px] text-muted-foreground">
                    {(selectedMenu.categories || []).length} categories · {totalItems} items
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedMenu.status === 'draft' && (
                  <button onClick={() => void handleUpdateStatus('active')} disabled={!!busy} className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[10px] font-medium disabled:opacity-60">Activate</button>
                )}
                {selectedMenu.status === 'active' && (
                  <button onClick={() => void handleUpdateStatus('inactive')} disabled={!!busy} className="h-7 px-2.5 rounded-md border text-[10px] disabled:opacity-60">Deactivate</button>
                )}
              </div>
            </div>

            {/* Categories + Items */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(selectedMenu.categories || []).map(cat => {
                const expanded = expandedCats.has(String(cat.id));
                return (
                  <div key={String(cat.id)} className="border rounded-lg overflow-hidden">
                    <button onClick={() => toggleCat(String(cat.id))}
                      className="w-full px-4 py-2.5 flex items-center gap-2 bg-muted/20 hover:bg-muted/40 transition-colors">
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="text-xs font-semibold flex-1 text-left">{cat.name}</span>
                      <span className="text-[10px] text-muted-foreground">{cat.items?.length || 0} items</span>
                    </button>
                    {expanded && (
                      <div>
                        {(cat.items || []).length === 0 ? (
                          <p className="px-4 py-3 text-xs text-muted-foreground">No products in this category</p>
                        ) : (
                          <div className="divide-y">
                            {(cat.items || []).map((item, idx) => (
                              <div key={String(item.id)} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10">
                                <span className="text-[10px] text-muted-foreground w-5 text-right">{idx + 1}.</span>
                                <Package className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">{item.productName || products.find(p => String(p.id) === String(item.productId))?.name || '(Unknown)'}</p>
                                  <p className="text-[10px] text-muted-foreground font-mono">{item.productCode || String(item.productId)}</p>
                                </div>
                                <StatusBadge status={item.productStatus} />
                                <button
                                  onClick={() => void handleRemoveItem(String(item.id))}
                                  disabled={busy === `rm:${item.id}`}
                                  className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-60"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Add product to category */}
                        {addingToCatId === String(cat.id) ? (
                          <div className="px-4 py-2 border-t bg-muted/10 flex items-center gap-2">
                            <select className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs"
                              value={addItemProductId} onChange={e => setAddItemProductId(e.target.value)}>
                              <option value="">Select product...</option>
                              {availableProducts.map(p => (
                                <option key={String(p.id)} value={String(p.id)}>{String(p.name || p.code)}</option>
                              ))}
                            </select>
                            <button onClick={() => void handleAddItem(String(cat.id))} disabled={!addItemProductId || !!busy}
                              className="h-7 px-2.5 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">Add</button>
                            <button onClick={() => { setAddingToCatId(null); setAddItemProductId(''); }}
                              className="h-7 w-7 rounded border flex items-center justify-center hover:bg-accent">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingToCatId(String(cat.id))}
                            className="w-full px-4 py-2 border-t text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 flex items-center gap-1.5">
                            <Plus className="h-3 w-3" />Add Product
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add category */}
              {addingCategory ? (
                <div className="border rounded-lg p-4 space-y-2 border-dashed border-primary/30">
                  <p className="text-xs font-semibold">New Category</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="h-7 rounded border border-input bg-background px-2 text-xs font-mono" placeholder="CODE"
                      value={catForm.code} onChange={e => setCatForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
                    <input className="h-7 rounded border border-input bg-background px-2 text-xs" placeholder="Category Name"
                      value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => void handleAddCategory()} disabled={!!busy} className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">
                      <Save className="h-3 w-3 inline mr-1" />Create
                    </button>
                    <button onClick={() => setAddingCategory(false)} className="h-6 px-2 rounded border text-[10px]">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingCategory(true)}
                  className="w-full border border-dashed rounded-lg py-3 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 flex items-center justify-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />Add Category
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
