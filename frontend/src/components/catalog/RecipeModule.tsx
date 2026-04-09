import { useState, useMemo } from 'react';
import {
  BookOpen, ArrowLeft, Search, Layers,
  CheckCircle2, Clock, FileEdit, Archive, AlertTriangle,
  Info, Calendar, User, Hash, Package, Plus, Trash2, Edit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mockRecipes, mockProducts, mockIngredients } from '@/data/mock-catalog';
import type { Recipe, RecipeLine } from '@/types/catalog';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: React.ElementType }> = {
  active: { label: 'Active', class: 'bg-success/10 text-success', icon: CheckCircle2 },
  draft: { label: 'Draft', class: 'bg-warning/10 text-warning', icon: FileEdit },
  archived: { label: 'Archived', class: 'bg-muted text-muted-foreground', icon: Archive },
};

const emptyRecipe = (): Partial<Recipe> => ({
  productId: '', productName: '', version: 1, status: 'draft', effectiveFrom: '',
  lines: [], totalCost: 0, yield: 1, yieldUnit: 'serving', costPerServing: 0,
  createdBy: 'Current User',
});

const emptyLine = (): RecipeLine => ({
  id: `rl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  ingredientId: '', ingredientName: '', quantity: 0, unit: '', costPerUnit: 0, lineCost: 0,
});

export function RecipeModule() {
  const [recipes, setRecipes] = useState<Recipe[]>(mockRecipes);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Recipe>>(emptyRecipe());
  const [formLines, setFormLines] = useState<RecipeLine[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return recipes.filter(r => {
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (search && !r.productName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [recipes, search, statusFilter]);

  const statusCounts = useMemo(() => ({
    All: recipes.length,
    active: recipes.filter(r => r.status === 'active').length,
    draft: recipes.filter(r => r.status === 'draft').length,
    archived: recipes.filter(r => r.status === 'archived').length,
  }), [recipes]);

  const openCreate = () => {
    setFormData(emptyRecipe()); setFormLines([emptyLine()]); setEditingId(null); setFormOpen(true);
  };
  const openEdit = (r: Recipe) => {
    setFormData({ ...r }); setFormLines([...r.lines]); setEditingId(r.id); setFormOpen(true); setSelected(null);
  };

  const recalcCosts = (lines: RecipeLine[], yld: number): { lines: RecipeLine[]; totalCost: number; costPerServing: number } => {
    const updated = lines.map(l => ({ ...l, lineCost: l.quantity * l.costPerUnit }));
    const totalCost = updated.reduce((s, l) => s + l.lineCost, 0);
    return { lines: updated, totalCost, costPerServing: yld > 0 ? totalCost / yld : 0 };
  };

  const handleSave = () => {
    if (!formData.productId || !formData.effectiveFrom) { toast.error('Product and effective date are required'); return; }
    const product = mockProducts.find(p => p.id === formData.productId);
    const { lines, totalCost, costPerServing } = recalcCosts(formLines, formData.yield || 1);
    if (editingId) {
      setRecipes(prev => prev.map(r => r.id === editingId ? { ...r, ...formData, productName: product?.name || formData.productName || '', lines, totalCost, costPerServing } as Recipe : r));
      toast.success('Recipe updated');
    } else {
      const nr: Recipe = {
        ...formData as Recipe,
        id: `rcp-${Date.now()}`,
        productName: product?.name || '',
        lines, totalCost, costPerServing,
        createdAt: new Date().toISOString().split('T')[0],
      };
      setRecipes(prev => [nr, ...prev]);
      toast.success('Recipe created');
    }
    setFormOpen(false);
  };

  const handleDelete = (id: string) => {
    setRecipes(prev => prev.filter(r => r.id !== id));
    setDeleteConfirm(null); setSelected(null);
    toast.success('Recipe deleted');
  };

  const addLine = () => setFormLines(prev => [...prev, emptyLine()]);
  const removeLine = (id: string) => setFormLines(prev => prev.filter(l => l.id !== id));
  const updateLine = <K extends keyof RecipeLine>(id: string, field: K, value: RecipeLine[K]) => {
    setFormLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === 'ingredientId') {
        const ing = mockIngredients.find(i => i.id === value);
        if (ing) { updated.ingredientName = ing.name; updated.unit = ing.defaultUnit; updated.costPerUnit = ing.costPerUnit; }
      }
      updated.lineCost = updated.quantity * updated.costPerUnit;
      return updated;
    }));
  };

  // Detail view
  if (selected) {
    const cfg = STATUS_CONFIG[selected.status];
    const StatusIcon = cfg.icon;
    const allVersions = recipes.filter(r => r.productId === selected.productId).sort((a, b) => b.version - a.version);
    const product = mockProducts.find(p => p.id === selected.productId);
    const maxLineCost = Math.max(...selected.lines.map(l => l.lineCost), 0.01);

    return (
      <div className="p-6 space-y-5 animate-fade-in">
        <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Back to recipes
        </button>

        {product && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-muted/30 border border-border">
            <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{product.name}</span><span>·</span>
              <span className="font-mono">{product.sku}</span><span>·</span><span>{product.category}</span><span>·</span>
              <span>Base ${product.basePrice.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-3 space-y-5">
            <div className="surface-elevated p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0', selected.status === 'active' ? 'bg-success/10' : selected.status === 'draft' ? 'bg-warning/10' : 'bg-muted/50')}>
                    <BookOpen className={cn('h-5 w-5', selected.status === 'active' ? 'text-success' : selected.status === 'draft' ? 'text-warning' : 'text-muted-foreground')} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-semibold text-foreground">{selected.productName}</h2>
                      <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">v{selected.version}</span>
                      <span className={cn('inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-medium', cfg.class)}><StatusIcon className="h-2.5 w-2.5" />{cfg.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {selected.effectiveFrom}{selected.effectiveTo ? ` → ${selected.effectiveTo}` : ' → present'}</span>
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> {selected.createdBy}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openEdit(selected)}><Edit className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
                  <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirm(selected.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Cost', value: `$${selected.totalCost.toFixed(2)}`, icon: Hash },
                { label: 'Cost / Serving', value: `$${selected.costPerServing.toFixed(2)}`, icon: Hash },
                { label: 'Yield', value: `${selected.yield} ${selected.yieldUnit}`, icon: Layers },
                { label: 'Ingredients', value: `${selected.lines.length} items`, icon: BookOpen },
              ].map(k => (
                <div key={k.label} className="surface-elevated p-4">
                  <div className="flex items-center gap-1.5 mb-2"><k.icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span></div>
                  <p className="text-xl font-semibold text-foreground">{k.value}</p>
                </div>
              ))}
            </div>

            {product && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-info/5 border border-info/10">
                <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-info leading-relaxed">
                  Base price ${product.basePrice.toFixed(2)} − recipe cost ${selected.totalCost.toFixed(2)} = <span className="font-semibold">${(product.basePrice - selected.totalCost).toFixed(2)} margin</span> ({Math.round(((product.basePrice - selected.totalCost) / product.basePrice) * 100)}% gross)
                </p>
              </div>
            )}

            <div className="surface-elevated overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Recipe Line Items</span>
                <span className="text-[10px] text-muted-foreground">{selected.lines.length} ingredient{selected.lines.length !== 1 ? 's' : ''}</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['#', 'Ingredient', 'Qty', 'UoM', 'Cost/Unit', 'Line Cost', '% of Total', 'Share'].map(h => (
                      <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', ['Qty', 'Cost/Unit', 'Line Cost', '% of Total'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line, idx) => {
                    const pct = selected.totalCost > 0 ? (line.lineCost / selected.totalCost) * 100 : 0;
                    return (
                      <tr key={line.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-foreground">{line.ingredientName}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">{line.quantity}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.unit}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">${line.costPerUnit.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">${line.lineCost.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</td>
                        <td className="px-4 py-2.5"><div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden"><div className="h-full bg-primary/40 rounded-full" style={{ width: `${maxLineCost > 0 ? (line.lineCost / maxLineCost) * 100 : 0}%` }} /></div></td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/20">
                    <td colSpan={5} className="px-4 py-2.5 text-right text-sm font-semibold">Total</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">${selected.totalCost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-medium">100%</td><td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Version Sidebar */}
          <div className="space-y-4">
            <div className="surface-elevated overflow-hidden">
              <div className="px-4 py-3 border-b"><span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">All Versions</span></div>
              <div className="divide-y divide-border">
                {allVersions.map(v => {
                  const vCfg = STATUS_CONFIG[v.status]; const VIcon = vCfg.icon; const isCurrent = v.id === selected.id;
                  return (
                    <button key={v.id} onClick={() => { if (!isCurrent) setSelected(v); }} className={cn('w-full px-4 py-3 text-left transition-colors', isCurrent ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/20')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn('font-mono text-sm font-medium', isCurrent ? 'text-primary' : 'text-foreground')}>v{v.version}</span>
                        <span className={cn('inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium', vCfg.class)}><VIcon className="h-2 w-2" />{vCfg.label}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground space-y-0.5">
                        <p>{v.effectiveFrom}{v.effectiveTo ? ` → ${v.effectiveTo}` : ''}</p>
                        <p className="font-mono">${v.costPerServing.toFixed(2)}/serving · {v.lines.length} items</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {allVersions.length > 1 && (
              <div className="surface-elevated overflow-hidden">
                <div className="px-4 py-3 border-b"><span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Cost Trend</span></div>
                <div className="p-4 space-y-2">
                  {allVersions.map(v => (
                    <div key={v.id} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-6">v{v.version}</span>
                      <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', v.status === 'active' ? 'bg-success' : v.status === 'draft' ? 'bg-warning' : 'bg-muted-foreground/30')} style={{ width: `${(v.costPerServing / Math.max(...allVersions.map(av => av.costPerServing))) * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">${v.costPerServing.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Delete this recipe version? This cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // List View
  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Recipes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Recipe versions, costing, and effective date management</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New Recipe</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Recipes', value: recipes.length, icon: BookOpen, color: 'text-foreground' },
          { label: 'Active', value: statusCounts.active, icon: CheckCircle2, color: 'text-success' },
          { label: 'Draft', value: statusCounts.draft, icon: FileEdit, color: statusCounts.draft > 0 ? 'text-warning' : 'text-foreground' },
          { label: 'Archived', value: statusCounts.archived, icon: Archive, color: 'text-muted-foreground' },
        ].map(kpi => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2"><kpi.icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span></div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search by product…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5">
          {(['All', 'active', 'draft', 'archived'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors', statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-foreground/20')}>
              {s === 'All' ? 'All' : STATUS_CONFIG[s].label} ({statusCounts[s]})
            </button>
          ))}
        </div>
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Product', 'Ver', 'Status', 'Effective From', 'Effective To', 'Items', 'Cost/Serving', 'Created By'].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', ['Ver', 'Items', 'Cost/Serving'].includes(h) ? (h === 'Ver' ? 'text-center' : 'text-right') : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No recipes match the current filters</td></tr>}
            {filtered.map(recipe => {
              const cfg2 = STATUS_CONFIG[recipe.status]; const SIcon = cfg2.icon;
              return (
                <tr key={recipe.id} onClick={() => setSelected(recipe)} className={cn('border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors', recipe.status === 'active' && 'bg-success/[0.02]')}>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{recipe.productName}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-sm font-medium">v{recipe.version}</td>
                  <td className="px-4 py-2.5"><span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium', cfg2.class)}><SIcon className="h-2.5 w-2.5" />{cfg2.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{recipe.effectiveFrom}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{recipe.effectiveTo || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-sm">{recipe.lines.length}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">${recipe.costPerServing.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{recipe.createdBy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Recipe Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Recipe' : 'Create New Recipe'}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Product *</Label>
                <Select value={formData.productId || ''} onValueChange={v => setFormData(p => ({ ...p, productId: v, productName: mockProducts.find(pr => pr.id === v)?.name || '' }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{mockProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label className="text-xs">Version</Label><Input type="number" value={formData.version || 1} onChange={e => setFormData(p => ({ ...p, version: Number(e.target.value) }))} className="h-8 text-sm" /></div>
              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <Select value={formData.status || 'draft'} onValueChange={v => setFormData(p => ({ ...p, status: v as Recipe['status'] }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label className="text-xs">Effective From *</Label><Input type="date" value={formData.effectiveFrom || ''} onChange={e => setFormData(p => ({ ...p, effectiveFrom: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="space-y-2"><Label className="text-xs">Effective To</Label><Input type="date" value={formData.effectiveTo || ''} onChange={e => setFormData(p => ({ ...p, effectiveTo: e.target.value }))} className="h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2"><Label className="text-xs">Yield</Label><Input type="number" value={formData.yield || 1} onChange={e => setFormData(p => ({ ...p, yield: Number(e.target.value) }))} className="h-8 text-sm" /></div>
                <div className="space-y-2"><Label className="text-xs">Unit</Label><Input value={formData.yieldUnit || 'serving'} onChange={e => setFormData(p => ({ ...p, yieldUnit: e.target.value }))} className="h-8 text-sm" /></div>
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</Label>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Line</Button>
              </div>
              <div className="surface-elevated overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Ingredient', 'Qty', 'Unit', 'Cost/Unit', 'Line Cost', ''].map(h => (
                        <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-3 py-2', ['Qty', 'Cost/Unit', 'Line Cost'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map(line => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <Select value={line.ingredientId || ''} onValueChange={v => updateLine(line.id, 'ingredientId', v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>{mockIngredients.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2"><Input type="number" step="0.01" value={line.quantity || ''} onChange={e => updateLine(line.id, 'quantity', Number(e.target.value))} className="h-7 text-xs w-20 text-right ml-auto" /></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{line.unit || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">${line.costPerUnit.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-medium">${(line.quantity * line.costPerUnit).toFixed(2)}</td>
                        <td className="px-3 py-2"><button onClick={() => removeLine(line.id)} className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center"><Trash2 className="h-3 w-3 text-muted-foreground" /></button></td>
                      </tr>
                    ))}
                    {formLines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No ingredients added yet</td></tr>}
                    {formLines.length > 0 && (
                      <tr className="bg-muted/20">
                        <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold">Total</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-bold">${formLines.reduce((s, l) => s + l.quantity * l.costPerUnit, 0).toFixed(2)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editingId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
