import { useState } from 'react';
import { Plus, Edit2, Percent, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface TaxRate {
  id: string;
  name: string;
  rate: number;
  type: 'sales' | 'purchase' | 'withholding';
  isDefault: boolean;
  isActive: boolean;
}

const INITIAL_RATES: TaxRate[] = [
  { id: '1', name: 'Standard GST', rate: 9, type: 'sales', isDefault: true, isActive: true },
  { id: '2', name: 'Reduced GST', rate: 5, type: 'sales', isDefault: false, isActive: true },
  { id: '3', name: 'Zero-rated', rate: 0, type: 'sales', isDefault: false, isActive: true },
  { id: '4', name: 'Input Tax', rate: 9, type: 'purchase', isDefault: true, isActive: true },
  { id: '5', name: 'Import Duty', rate: 5, type: 'purchase', isDefault: false, isActive: true },
  { id: '6', name: 'WHT - Standard', rate: 15, type: 'withholding', isDefault: true, isActive: true },
  { id: '7', name: 'WHT - Reduced', rate: 10, type: 'withholding', isDefault: false, isActive: false },
];

const TYPE_STYLES: Record<string, string> = {
  sales: 'bg-primary/10 text-primary',
  purchase: 'bg-warning/10 text-warning',
  withholding: 'bg-destructive/10 text-destructive',
};

const TAX_TYPES: TaxRate['type'][] = ['sales', 'purchase', 'withholding'];

const emptyForm = { name: '', rate: '', type: 'sales' as TaxRate['type'], isDefault: false, isActive: true };

export function TaxSetupModule() {
  const [filter, setFilter] = useState<string>('all');
  const [rates, setRates] = useState<TaxRate[]>(INITIAL_RATES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TaxRate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxRate | null>(null);
  const [form, setForm] = useState(emptyForm);

  const filtered = filter === 'all' ? rates : rates.filter(t => t.type === filter);

  const openCreate = () => { setEditTarget(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (t: TaxRate) => { setEditTarget(t); setForm({ name: t.name, rate: t.rate.toString(), type: t.type, isDefault: t.isDefault, isActive: t.isActive }); setDialogOpen(true); };

  const handleSave = () => {
    if (!form.name || !form.rate) { toast.error('Name and rate are required'); return; }
    if (editTarget) {
      setRates(prev => prev.map(r => r.id === editTarget.id ? { ...r, name: form.name, rate: parseFloat(form.rate), type: form.type, isDefault: form.isDefault, isActive: form.isActive } : r));
      toast.success(`Tax rate "${form.name}" updated`);
    } else {
      const newRate: TaxRate = { id: `tax-${Date.now()}`, name: form.name, rate: parseFloat(form.rate), type: form.type, isDefault: form.isDefault, isActive: form.isActive };
      setRates(prev => [...prev, newRate]);
      toast.success(`Tax rate "${form.name}" created`);
    }
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setRates(prev => prev.filter(r => r.id !== deleteTarget.id));
    toast.success(`Tax rate "${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
  };

  const toggleActive = (id: string) => {
    setRates(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r));
    toast.success('Status updated');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tax Rate Configuration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage tax rates for sales, purchases, and withholding</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3 w-3" /> Add Tax Rate</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {TAX_TYPES.map(type => {
          const active = rates.filter(t => t.type === type && t.isActive);
          const defaultRate = active.find(r => r.isDefault);
          return (
            <div key={type} className="surface-elevated p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilter(type)}>
              <div className="flex items-center gap-1.5 mb-2">
                <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide capitalize">{type} Tax</span>
              </div>
              <p className="text-xl font-semibold text-foreground">{defaultRate ? `${defaultRate.rate}%` : '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{active.length} active rates</p>
            </div>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-1">
        {['all', ...TAX_TYPES].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-[10px] px-2.5 py-1 rounded-md transition-colors capitalize',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Name', 'Type', 'Rate', 'Default', 'Status', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Rate' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors group">
                <td className="px-4 py-2.5 text-sm font-medium text-foreground">{t.name}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', TYPE_STYLES[t.type])}>{t.type}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">{t.rate}%</td>
                <td className="px-4 py-2.5">
                  {t.isDefault && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Default</span>}
                </td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggleActive(t.id)}>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer',
                      t.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    )}>{t.isActive ? 'Active' : 'Inactive'}</span>
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(t)}><Edit2 className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteTarget(t)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Tax Rate' : 'Add Tax Rate'}</DialogTitle>
            <DialogDescription>{editTarget ? 'Update tax rate details' : 'Create a new tax rate'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard GST" className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Rate (%)</Label>
                <Input type="number" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} placeholder="9" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as TaxRate['type'] }))} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {TAX_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={form.isDefault} onCheckedChange={v => setForm(f => ({ ...f, isDefault: v }))} />
                <Label className="text-xs">Default</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <Label className="text-xs">Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editTarget ? 'Save Changes' : 'Create Rate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Tax Rate</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{deleteTarget?.name}"?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
