import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Plus, Trash2, RefreshCw, Loader2, Save, X, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  productApi,
  type ProductView, type VariantView, type ModifierGroupView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { StatusBadge } from '@/components/catalog/StatusBadge';

interface VariantsModuleProps {
  token: string;
}

export function VariantsModule({ token }: VariantsModuleProps) {
  const [subTab, setSubTab] = useState<'variants' | 'modifiers'>('variants');
  const [products, setProducts] = useState<ProductView[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [variants, setVariants] = useState<VariantView[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  // Variant form
  const [showVarForm, setShowVarForm] = useState(false);
  const [varForm, setVarForm] = useState({ code: '', name: '', priceModifierType: 'none', priceModifierValue: '0' });

  // Modifier group form
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupForm, setGroupForm] = useState({ code: '', name: '', selectionType: 'single', maxSelections: '1' });

  // Add option form
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [optionForm, setOptionForm] = useState({ code: '', name: '', priceAdjustment: '0' });

  useEffect(() => {
    if (!token) return;
    productApi.products(token).then(setProducts).catch(() => {});
  }, [token]);

  const loadVariants = useCallback(async () => {
    if (!token || !selectedProductId) { setVariants([]); return; }
    setLoading(true);
    try { setVariants(await productApi.variants(token, selectedProductId)); }
    catch { setVariants([]); }
    finally { setLoading(false); }
  }, [token, selectedProductId]);

  const loadModifiers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setModifierGroups(await productApi.modifierGroups(token)); }
    catch { setModifierGroups([]); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (subTab === 'variants') void loadVariants(); }, [subTab, loadVariants]);
  useEffect(() => { if (subTab === 'modifiers') void loadModifiers(); }, [subTab, loadModifiers]);

  const createVariant = async () => {
    if (!selectedProductId || !varForm.code.trim() || !varForm.name.trim()) { toast.error('Select product and fill code/name'); return; }
    setBusy('create-var');
    try {
      await productApi.createVariant(token, { productId: selectedProductId, code: varForm.code, name: varForm.name, priceModifierType: varForm.priceModifierType, priceModifierValue: Number(varForm.priceModifierValue) || 0 });
      toast.success('Variant created');
      setShowVarForm(false);
      setVarForm({ code: '', name: '', priceModifierType: 'none', priceModifierValue: '0' });
      void loadVariants();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const deleteVariant = async (id: string) => {
    setBusy(`del-var:${id}`);
    try { await productApi.deleteVariant(token, id); toast.success('Deleted'); void loadVariants(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const createGroup = async () => {
    if (!groupForm.code.trim() || !groupForm.name.trim()) { toast.error('Code and name required'); return; }
    setBusy('create-grp');
    try {
      await productApi.createModifierGroup(token, { code: groupForm.code, name: groupForm.name, selectionType: groupForm.selectionType, maxSelections: Number(groupForm.maxSelections) || 1 });
      toast.success('Modifier group created');
      setShowGroupForm(false);
      setGroupForm({ code: '', name: '', selectionType: 'single', maxSelections: '1' });
      void loadModifiers();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const addOption = async (groupId: string) => {
    if (!optionForm.code.trim() || !optionForm.name.trim()) { toast.error('Code and name required'); return; }
    setBusy('add-opt');
    try {
      await productApi.addModifierOption(token, groupId, { code: optionForm.code, name: optionForm.name, priceAdjustment: Number(optionForm.priceAdjustment) || 0 });
      toast.success('Option added');
      setAddingToGroupId(null);
      setOptionForm({ code: '', name: '', priceAdjustment: '0' });
      void loadModifiers();
    } catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const deleteOption = async (optionId: string) => {
    setBusy(`del-opt:${optionId}`);
    try { await productApi.deleteModifierOption(token, optionId); toast.success('Deleted'); void loadModifiers(); }
    catch (e) { toast.error(getErrorMessage(e, 'Failed')); } finally { setBusy(''); }
  };

  const selectedProduct = products.find(p => String(p.id) === selectedProductId);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Sub-tabs */}
      <div className="border-b px-5 flex items-center gap-0 flex-shrink-0">
        <button onClick={() => setSubTab('variants')} className={cn('px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors', subTab === 'variants' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          Product Variants
        </button>
        <button onClick={() => setSubTab('modifiers')} className={cn('px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors', subTab === 'modifiers' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          Modifier Groups
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {subTab === 'variants' ? (
          <>
            {/* Product selector */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <select className="h-8 flex-1 max-w-md rounded-md border border-input bg-background px-2 text-xs"
                  value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
                  <option value="">Select product to manage variants...</option>
                  {products.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.name || p.code)} ({String(p.code)})</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => subTab === 'variants' ? void loadVariants() : void loadModifiers()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </button>
                {selectedProductId && (
                  <button onClick={() => setShowVarForm(true)} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1">
                    <Plus className="h-3 w-3" />Add Variant
                  </button>
                )}
              </div>
            </div>

            {/* Create variant form */}
            {showVarForm && (
              <div className="border rounded-lg p-4 space-y-3 border-l-2 border-l-primary bg-muted/10">
                <p className="text-xs font-semibold">New Variant for {selectedProduct?.name || '?'}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">Code</label><input className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs font-mono" placeholder="e.g. LARGE" value={varForm.code} onChange={e => setVarForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Name</label><input className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="e.g. Large" value={varForm.name} onChange={e => setVarForm(f => ({ ...f, name: e.target.value }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Price Modifier</label><select className="mt-0.5 h-7 w-full rounded border border-input bg-background px-1 text-xs" value={varForm.priceModifierType} onChange={e => setVarForm(f => ({ ...f, priceModifierType: e.target.value }))}><option value="none">None</option><option value="fixed">Fixed (+amount)</option><option value="percentage">Percentage (+%)</option></select></div>
                  <div><label className="text-[10px] text-muted-foreground">Value</label><input type="number" className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs" value={varForm.priceModifierValue} onChange={e => setVarForm(f => ({ ...f, priceModifierValue: e.target.value }))} /></div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => void createVariant()} disabled={!!busy} className="h-7 px-3 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60 inline-flex items-center gap-1"><Save className="h-3 w-3" />Create</button>
                  <button onClick={() => setShowVarForm(false)} className="h-7 px-3 rounded border text-[10px] hover:bg-accent">Cancel</button>
                </div>
              </div>
            )}

            {/* Variants list */}
            {!selectedProductId ? (
              <div className="surface-elevated p-10 text-center"><Layers className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-xs text-muted-foreground">Select a product to view and manage its size/form variants</p></div>
            ) : loading ? (
              <div className="surface-elevated p-10 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
            ) : variants.length === 0 ? (
              <div className="surface-elevated p-10 text-center"><Layers className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-xs text-muted-foreground">No variants for this product</p>
                <button onClick={() => setShowVarForm(true)} className="mt-2 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add First Variant</button></div>
            ) : (
              <div className="surface-elevated overflow-hidden">
                <table className="w-full"><thead><tr className="border-b bg-muted/30">
                  <th className="text-left text-[11px] px-4 py-2.5 font-medium">Code</th>
                  <th className="text-left text-[11px] px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left text-[11px] px-4 py-2.5 font-medium">Price Modifier</th>
                  <th className="text-center text-[11px] px-4 py-2.5 font-medium">Status</th>
                  <th className="w-16"></th>
                </tr></thead><tbody>
                  {variants.map(v => (
                    <tr key={String(v.id)} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs font-mono">{v.code}</td>
                      <td className="px-4 py-2.5 text-sm">{v.name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {v.priceModifierType === 'none' ? '—' : v.priceModifierType === 'percentage' ? `+${v.priceModifierValue}%` : `+${Number(v.priceModifierValue).toLocaleString()}`}
                      </td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={v.isActive ? 'active' : 'inactive'} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => void deleteVariant(String(v.id))} disabled={busy === `del-var:${v.id}`}
                          className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-60">
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Modifier groups */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Modifier Groups ({modifierGroups.length})</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => void loadModifiers()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </button>
                <button onClick={() => setShowGroupForm(true)} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" />Add Group
                </button>
              </div>
            </div>

            {showGroupForm && (
              <div className="border rounded-lg p-4 space-y-3 border-l-2 border-l-primary bg-muted/10">
                <p className="text-xs font-semibold">New Modifier Group</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">Code</label><input className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs font-mono" placeholder="e.g. SUGAR_LEVEL" value={groupForm.code} onChange={e => setGroupForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Name</label><input className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="e.g. Sugar Level" value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} /></div>
                  <div><label className="text-[10px] text-muted-foreground">Selection</label><select className="mt-0.5 h-7 w-full rounded border border-input bg-background px-1 text-xs" value={groupForm.selectionType} onChange={e => setGroupForm(f => ({ ...f, selectionType: e.target.value }))}><option value="single">Single</option><option value="multiple">Multiple</option></select></div>
                  <div><label className="text-[10px] text-muted-foreground">Max Selections</label><input type="number" min="1" className="mt-0.5 h-7 w-full rounded border border-input bg-background px-2 text-xs" value={groupForm.maxSelections} onChange={e => setGroupForm(f => ({ ...f, maxSelections: e.target.value }))} /></div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => void createGroup()} disabled={!!busy} className="h-7 px-3 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60 inline-flex items-center gap-1"><Save className="h-3 w-3" />Create</button>
                  <button onClick={() => setShowGroupForm(false)} className="h-7 px-3 rounded border text-[10px] hover:bg-accent">Cancel</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="surface-elevated p-10 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
            ) : modifierGroups.length === 0 ? (
              <div className="surface-elevated p-10 text-center"><Settings2 className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" /><p className="text-xs text-muted-foreground">No modifier groups yet</p>
                <button onClick={() => setShowGroupForm(true)} className="mt-2 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[10px] font-medium inline-flex items-center gap-1"><Plus className="h-3 w-3" />Create First Group</button></div>
            ) : (
              <div className="space-y-3">
                {modifierGroups.map(group => (
                  <div key={String(group.id)} className="border rounded-lg overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted/20 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold">{group.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{group.code} · {group.selectionType} · max {group.maxSelections}</p>
                      </div>
                      <StatusBadge status={group.isActive ? 'active' : 'inactive'} />
                    </div>
                    <div className="divide-y">
                      {(group.options || []).map(opt => (
                        <div key={String(opt.id)} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10">
                          <span className="text-xs flex-1">{opt.name} <span className="text-muted-foreground font-mono">({opt.code})</span></span>
                          {opt.priceAdjustment !== 0 && <span className="text-[10px] font-mono text-emerald-600">+{Number(opt.priceAdjustment).toLocaleString()}</span>}
                          <button onClick={() => void deleteOption(String(opt.id))} disabled={busy === `del-opt:${opt.id}`}
                            className="h-5 w-5 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-60">
                            <Trash2 className="h-2 w-2" />
                          </button>
                        </div>
                      ))}
                      {addingToGroupId === String(group.id) ? (
                        <div className="px-4 py-2 bg-muted/10 space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <input className="h-7 rounded border border-input bg-background px-2 text-xs font-mono" placeholder="CODE" value={optionForm.code} onChange={e => setOptionForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
                            <input className="h-7 rounded border border-input bg-background px-2 text-xs" placeholder="Name" value={optionForm.name} onChange={e => setOptionForm(f => ({ ...f, name: e.target.value }))} />
                            <input type="number" className="h-7 rounded border border-input bg-background px-2 text-xs" placeholder="Price +/-" value={optionForm.priceAdjustment} onChange={e => setOptionForm(f => ({ ...f, priceAdjustment: e.target.value }))} />
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => void addOption(String(group.id))} disabled={!!busy} className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-60">Add</button>
                            <button onClick={() => setAddingToGroupId(null)} className="h-6 px-2 rounded border text-[10px]">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setAddingToGroupId(String(group.id)); setOptionForm({ code: '', name: '', priceAdjustment: '0' }); }}
                          className="w-full px-4 py-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 flex items-center gap-1.5">
                          <Plus className="h-3 w-3" />Add Option
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
