import { useCallback, useEffect, useState } from 'react';
import {
  FolderTree, Plus, Save, Edit2, X, RefreshCw, Loader2, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, type CategoryView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { StatusBadge } from '@/components/catalog/StatusBadge';

type CatType = 'product' | 'item';

interface CategoryManagerProps {
  token: string;
}

export function CategoryManager({ token }: CategoryManagerProps) {
  const [activeType, setActiveType] = useState<CatType>('product');
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ code: '', name: '', description: '' });
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', isActive: true });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = activeType === 'product'
        ? await productApi.productCategories(token)
        : await productApi.itemCategories(token);
      setCategories(data);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load categories'));
    } finally {
      setLoading(false);
    }
  }, [token, activeType]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!createForm.code.trim() || !createForm.name.trim()) {
      toast.error('Code and Name required');
      return;
    }
    setBusy('create');
    try {
      if (activeType === 'product') {
        await productApi.createProductCategory(token, createForm);
      } else {
        await productApi.createItemCategory(token, createForm);
      }
      toast.success('Category created');
      setCreateForm({ code: '', name: '', description: '' });
      setCreating(false);
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to create'));
    } finally {
      setBusy('');
    }
  };

  const startEdit = (cat: CategoryView) => {
    setEditingCode(cat.code);
    setEditForm({ name: cat.name, description: cat.description || '', isActive: cat.isActive });
  };

  const saveEdit = async () => {
    if (!editingCode) return;
    if (!editForm.name.trim()) { toast.error('Name is required'); return; }
    if (activeType !== 'product') { toast.error('Item category editing not yet supported'); return; }
    setBusy('edit');
    try {
      await productApi.updateProductCategory(token, editingCode, editForm);
      toast.success('Category updated');
      setEditingCode(null);
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to update'));
    } finally {
      setBusy('');
    }
  };

  const toggleActive = async (cat: CategoryView) => {
    if (activeType !== 'product') { toast.error('Item category toggle not yet supported'); return; }
    setBusy(`toggle:${cat.code}`);
    try {
      await productApi.updateProductCategory(token, cat.code, { isActive: !cat.isActive });
      toast.success(cat.isActive ? 'Deactivated' : 'Activated');
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed'));
    } finally {
      setBusy('');
    }
  };

  const activeCount = categories.filter(c => c.isActive).length;

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      {/* Type toggle + header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            Category Management
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {categories.length} total · {activeCount} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setActiveType('product')}
              className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors',
                activeType === 'product' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              Product
            </button>
            <button
              onClick={() => setActiveType('item')}
              className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors border-l',
                activeType === 'item' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              Ingredient
            </button>
          </div>
          <button onClick={() => void load()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button onClick={() => setCreating(true)} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />Add
          </button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="surface-elevated p-4 space-y-3 border-l-2 border-l-primary">
          <p className="text-xs font-semibold">New {activeType === 'product' ? 'Product' : 'Ingredient'} Category</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground">Code</label>
              <input className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm font-mono"
                placeholder="e.g. BEVERAGE" value={createForm.code}
                onChange={e => setCreateForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Name</label>
              <input className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                placeholder="e.g. Beverages" value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Description</label>
              <input className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                placeholder="Optional" value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void handleCreate()} disabled={!!busy} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1 disabled:opacity-60">
              <Save className="h-3 w-3" />{busy === 'create' ? '...' : 'Create'}
            </button>
            <button onClick={() => setCreating(false)} className="h-7 px-3 rounded-md border text-xs hover:bg-accent">Cancel</button>
          </div>
        </div>
      )}

      {/* Category table */}
      <div className="surface-elevated overflow-hidden">
        {loading && categories.length === 0 ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : categories.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No categories</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Code</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Name</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Description</th>
                <th className="text-center text-[11px] px-4 py-2.5 font-medium">Status</th>
                <th className="text-right text-[11px] px-4 py-2.5 font-medium w-32"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.code} className="border-b last:border-0 hover:bg-muted/20">
                  {editingCode === cat.code ? (
                    <>
                      <td className="px-4 py-2 text-xs font-mono">{cat.code}</td>
                      <td className="px-4 py-2">
                        <input className="h-7 w-full rounded border border-input bg-background px-2 text-sm"
                          value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2">
                        <input className="h-7 w-full rounded border border-input bg-background px-2 text-sm"
                          value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select className="h-7 rounded border border-input bg-background px-1 text-xs"
                          value={editForm.isActive ? 'active' : 'inactive'}
                          onChange={e => setEditForm(f => ({ ...f, isActive: e.target.value === 'active' }))}>
                          <option value="active">active</option><option value="inactive">inactive</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => void saveEdit()} disabled={!!busy} className="h-6 w-6 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
                            <Check className="h-3 w-3 text-emerald-600" />
                          </button>
                          <button onClick={() => setEditingCode(null)} className="h-6 w-6 rounded border flex items-center justify-center hover:bg-accent">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-xs font-mono">{cat.code}</td>
                      <td className="px-4 py-2.5 text-sm">{cat.name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{cat.description || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge status={cat.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {activeType === 'product' ? (
                            <>
                              <button onClick={() => startEdit(cat)} className="h-6 px-2 rounded border text-[10px] inline-flex items-center gap-1 hover:bg-accent">
                                <Edit2 className="h-2.5 w-2.5" />
                              </button>
                              <button
                                onClick={() => void toggleActive(cat)}
                                disabled={busy === `toggle:${cat.code}`}
                                className="h-6 px-2 rounded border text-[10px] hover:bg-accent disabled:opacity-60"
                              >
                                {cat.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">read-only</span>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
