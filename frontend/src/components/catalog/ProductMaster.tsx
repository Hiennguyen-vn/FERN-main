import { useState } from 'react';
import { Search, Plus, LinkIcon, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mockProducts, PRODUCT_STATUS_CONFIG } from '@/data/mock-catalog';
import { cn } from '@/lib/utils';
import type { Product, ProductStatus } from '@/types/catalog';
import { toast } from 'sonner';

const emptyProduct = (): Partial<Product> => ({
  name: '', sku: '', category: '', status: 'draft', basePrice: 0, taxRate: 8,
  hasRecipe: false, availableOutlets: 0, totalOutlets: 3,
});

export function ProductMaster() {
  const [products, setProducts] = useState<Product[]>(mockProducts);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>(emptyProduct());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = products.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openCreate = () => { setFormData(emptyProduct()); setEditingId(null); setFormOpen(true); };
  const openEdit = (p: Product) => { setFormData({ ...p }); setEditingId(p.id); setFormOpen(true); setSelected(null); };

  const handleSave = () => {
    if (!formData.name || !formData.sku || !formData.category) {
      toast.error('Please fill in all required fields'); return;
    }
    if (editingId) {
      setProducts(prev => prev.map(p => p.id === editingId ? { ...p, ...formData, updatedAt: new Date().toISOString().split('T')[0] } as Product : p));
      toast.success('Product updated');
    } else {
      const np: Product = {
        ...formData as Product,
        id: `prod-${Date.now()}`,
        createdAt: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString().split('T')[0],
      };
      setProducts(prev => [np, ...prev]);
      toast.success('Product created');
    }
    setFormOpen(false);
  };

  const handleDelete = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null); setSelected(null);
    toast.success('Product deleted');
  };

  const updateField = <K extends keyof Product>(key: K, val: Product[K]) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  if (selected) {
    const statusCfg = PRODUCT_STATUS_CONFIG[selected.status];
    return (
      <div className="p-6 space-y-5 animate-fade-in">
        <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">← Back to products</button>
        <div className="surface-elevated p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                <span className={cn('text-[10px] px-2.5 py-1 rounded-full font-medium', statusCfg.class)}>{statusCfg.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{selected.sku} · {selected.category}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openEdit(selected)}>
                <Edit className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
              {selected.status === 'active' && <Button variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/5">Deactivate</Button>}
              <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirm(selected.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Base Price', value: `$${selected.basePrice.toFixed(2)}`, sub: `Tax: ${selected.taxRate}% GST` },
            { label: 'Recipe', value: selected.hasRecipe ? 'Linked' : 'None', sub: selected.hasRecipe ? 'Active recipe assigned' : 'No recipe configured' },
            { label: 'Availability', value: `${selected.availableOutlets}/${selected.totalOutlets}`, sub: 'Outlets serving this product' },
          ].map(k => (
            <div key={k.label} className="surface-elevated p-4">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
              <p className="text-xl font-semibold text-foreground mt-1">{k.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="surface-elevated p-4 space-y-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Product Information</span>
            <div className="space-y-2 text-sm">
              {[['SKU', selected.sku, true], ['Category', selected.category], ['Created', selected.createdAt], ['Last Updated', selected.updatedAt]].map(([label, value, mono]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="text-muted-foreground text-xs">{label as string}</span>
                  <span className={cn('font-medium text-xs', mono && 'font-mono')}>{value as string}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="surface-elevated p-4 space-y-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Pricing Summary</span>
            <div className="space-y-2 text-sm">
              {[['Base Price', `$${selected.basePrice.toFixed(2)}`, true], ['Tax Rate', `${selected.taxRate}%`], ['Price (incl. tax)', `$${(selected.basePrice * (1 + selected.taxRate / 100)).toFixed(2)}`, true]].map(([label, value, mono]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="text-muted-foreground text-xs">{label as string}</span>
                  <span className={cn('font-medium text-xs', mono && 'font-mono')}>{value as string}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Delete</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Are you sure you want to delete this product?</p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Product Master</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage product catalog, lifecycle, and recipe linkage</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New Product
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search by name or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5">
          {['all', 'active', 'draft', 'inactive', 'discontinued'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn('text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize', statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border')}>{s}</button>
          ))}
        </div>
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['SKU', 'Product Name', 'Category', 'Status', 'Recipe', 'Base Price', 'Availability'].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Base Price' ? 'text-right' : h === 'Availability' ? 'text-center' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">No matching products</td></tr>
            ) : filtered.map(product => {
              const statusCfg = PRODUCT_STATUS_CONFIG[product.status];
              return (
                <tr key={product.id} onClick={() => setSelected(product)} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-primary font-mono">{product.sku}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{product.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{product.category}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', statusCfg.class)}>{statusCfg.label}</span></td>
                  <td className="px-4 py-2.5">{product.hasRecipe ? <span className="flex items-center gap-1 text-success text-xs"><LinkIcon className="h-3 w-3" /> Linked</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">${product.basePrice.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-center"><span className={cn('text-[10px] font-medium', product.availableOutlets === product.totalOutlets ? 'text-success' : product.availableOutlets === 0 ? 'text-muted-foreground' : 'text-warning')}>{product.availableOutlets}/{product.totalOutlets}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Product' : 'Create New Product'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Product Name *</Label>
                <Input value={formData.name || ''} onChange={e => updateField('name', e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">SKU *</Label>
                <Input value={formData.sku || ''} onChange={e => updateField('sku', e.target.value.toUpperCase())} className="h-8 text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Category *</Label>
                <Input value={formData.category || ''} onChange={e => updateField('category', e.target.value)} placeholder="e.g. Pizza, Bowls" className="h-8 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <Select value={formData.status || 'draft'} onValueChange={v => updateField('status', v as ProductStatus)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="discontinued">Discontinued</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Base Price ($)</Label>
                <Input type="number" step="0.01" value={formData.basePrice || ''} onChange={e => updateField('basePrice', Number(e.target.value))} className="h-8 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Tax Rate (%)</Label>
                <Input type="number" value={formData.taxRate || ''} onChange={e => updateField('taxRate', Number(e.target.value))} className="h-8 text-sm" />
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
