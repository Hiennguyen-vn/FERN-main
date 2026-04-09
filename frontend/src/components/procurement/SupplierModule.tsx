import { useState, useMemo } from 'react';
import {
  Search, Plus, Edit2, CheckCircle2, XCircle, Trash2,
  Phone, Mail, Building2, FileText, CreditCard, AlertTriangle,
  Power, PowerOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { Supplier, SupplierStatus } from '@/types/procurement';
import { mockSuppliers, mockPurchaseOrders } from '@/data/mock-procurement';
import { toast } from 'sonner';

const STATUS_CFG: Record<SupplierStatus, { label: string; class: string }> = {
  active: { label: 'Active', class: 'bg-success/10 text-success' },
  inactive: { label: 'Inactive', class: 'bg-muted text-muted-foreground' },
  pending: { label: 'Pending', class: 'bg-warning/10 text-warning' },
};

export function SupplierModule() {
  const [suppliers, setSuppliers] = useState<Supplier[]>(mockSuppliers);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierStatus | 'all'>('all');
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '', legalName: '', contactName: '', contactPhone: '', contactEmail: '',
    paymentTerms: 'Net 30', taxId: '', bankName: '', bankAccount: '', address: '', notes: '',
  });

  const filtered = useMemo(() => suppliers.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.contactName.toLowerCase().includes(q);
    }
    return true;
  }), [suppliers, search, statusFilter]);

  const kpis = useMemo(() => {
    const active = suppliers.filter(s => s.status === 'active').length;
    const pending = suppliers.filter(s => s.status === 'pending').length;
    const taxReady = suppliers.filter(s => s.taxReady).length;
    return [
      { label: 'Active Suppliers', value: active, sub: `of ${suppliers.length} total`, color: 'text-success' },
      { label: 'Pending Onboarding', value: pending, sub: 'awaiting approval', color: pending > 0 ? 'text-warning' : 'text-foreground' },
      { label: 'Tax Registered', value: taxReady, sub: `${((taxReady / suppliers.length) * 100).toFixed(0)}% compliant`, color: 'text-foreground' },
      { label: 'Inactive', value: suppliers.filter(s => s.status === 'inactive').length, sub: 'deactivated', color: 'text-muted-foreground' },
    ];
  }, [suppliers]);

  const openCreate = () => {
    setEditingId(null);
    setFormData({ name: '', legalName: '', contactName: '', contactPhone: '', contactEmail: '', paymentTerms: 'Net 30', taxId: '', bankName: '', bankAccount: '', address: '', notes: '' });
    setFormOpen(true);
  };

  const openEdit = (sup: Supplier) => {
    setEditingId(sup.id);
    setFormData({
      name: sup.name, legalName: sup.legalName || '', contactName: sup.contactName,
      contactPhone: sup.contactPhone, contactEmail: sup.contactEmail,
      paymentTerms: sup.paymentTerms, taxId: sup.taxId || '',
      bankName: sup.bankName || '', bankAccount: sup.bankAccount || '',
      address: sup.address || '', notes: sup.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim() || !formData.contactName.trim()) {
      toast.error('Name and Contact Name are required');
      return;
    }
    if (editingId) {
      setSuppliers(prev => prev.map(s => s.id === editingId ? {
        ...s, name: formData.name, legalName: formData.legalName || undefined,
        contactName: formData.contactName, contactPhone: formData.contactPhone,
        contactEmail: formData.contactEmail, paymentTerms: formData.paymentTerms,
        taxId: formData.taxId || undefined, bankName: formData.bankName || undefined,
        bankAccount: formData.bankAccount || undefined, address: formData.address || undefined,
        notes: formData.notes || undefined, taxReady: !!formData.taxId,
      } : s));
      toast.success('Supplier updated');
    } else {
      const newSup: Supplier = {
        id: `sup-${Date.now()}`, code: `SUP-${String(suppliers.length + 1).padStart(3, '0')}`,
        name: formData.name, legalName: formData.legalName || undefined,
        status: 'pending', paymentTerms: formData.paymentTerms,
        taxId: formData.taxId || undefined, taxReady: !!formData.taxId,
        contactName: formData.contactName, contactEmail: formData.contactEmail,
        contactPhone: formData.contactPhone, address: formData.address || undefined,
        bankName: formData.bankName || undefined, bankAccount: formData.bankAccount || undefined,
        createdAt: new Date().toISOString().slice(0, 10), notes: formData.notes || undefined,
      };
      setSuppliers(prev => [newSup, ...prev]);
      toast.success('Supplier created');
    }
    setFormOpen(false);
    setSelected(null);
  };

  const handleDelete = (id: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== id));
    setDeleteConfirm(null);
    setSelected(null);
    toast.success('Supplier deleted');
  };

  const toggleStatus = (sup: Supplier) => {
    const newStatus: SupplierStatus = sup.status === 'active' ? 'inactive' : 'active';
    setSuppliers(prev => prev.map(s => s.id === sup.id ? { ...s, status: newStatus } : s));
    setSelected(prev => prev?.id === sup.id ? { ...prev, status: newStatus } : prev);
    toast.success(`Supplier ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
  };

  const relatedPOs = (supplierId: string) => mockPurchaseOrders.filter(p => p.supplierId === supplierId);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Suppliers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Master data — managed by procurement and finance</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New Supplier
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <div key={kpi.label} className="surface-elevated p-3.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            <p className={cn('text-xl font-semibold mt-1', kpi.color)}>{kpi.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search suppliers…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        {(['all', 'active', 'inactive', 'pending'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
            )}>{s === 'all' ? 'All' : STATUS_CFG[s].label}</button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Code', 'Supplier Name', 'Status', 'Payment Terms', 'Tax Ready', 'Contact'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No suppliers found</p>
              </td></tr>
            ) : filtered.map(sup => {
              const cfg = STATUS_CFG[sup.status];
              return (
                <tr key={sup.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelected(sup)}>
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{sup.code}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{sup.name}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{sup.paymentTerms}</td>
                  <td className="px-4 py-2.5">
                    {sup.taxReady
                      ? <span className="text-[10px] font-medium text-success flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Ready</span>
                      : <span className="text-[10px] font-medium text-warning flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Pending</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{sup.contactName}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[10px] text-muted-foreground">Showing {filtered.length} of {suppliers.length} suppliers</span>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_CFG[selected.status].class)}>{STATUS_CFG[selected.status].label}</span>}
              {selected && (selected.taxReady
                ? <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-success/10 text-success">Tax Ready</span>
                : <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning">Tax Pending</span>
              )}
            </div>
            <SheetTitle className="text-base">{selected?.name}</SheetTitle>
            <SheetDescription>{selected?.code} · {selected?.legalName || selected?.name}</SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="p-6 space-y-6">
              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { openEdit(selected); }}>
                  <Edit2 className="h-3 w-3" /> Edit
                </Button>
                {selected.status !== 'pending' && (
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => toggleStatus(selected)}>
                    {selected.status === 'active' ? <><PowerOff className="h-3 w-3" /> Deactivate</> : <><Power className="h-3 w-3" /> Activate</>}
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteConfirm(selected.id)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              </div>

              {/* Contact & Legal */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contact & Legal</span>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    { icon: Building2, label: 'Legal Name', value: selected.legalName || '—' },
                    { icon: FileText, label: 'Tax ID', value: selected.taxId || 'Not registered' },
                    { icon: Phone, label: 'Phone', value: selected.contactPhone },
                    { icon: Mail, label: 'Email', value: selected.contactEmail },
                  ].map(f => (
                    <div key={f.label} className="flex items-center gap-2">
                      <f.icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">{f.label}</p>
                        <p className="text-xs text-foreground">{f.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {selected.address && <div className="mt-3"><p className="text-[10px] text-muted-foreground">Address</p><p className="text-xs text-foreground">{selected.address}</p></div>}
              </div>

              {/* Payment & Banking */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Payment & Banking</span>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div><p className="text-[10px] text-muted-foreground">Payment Terms</p><p className="text-xs font-medium text-foreground">{selected.paymentTerms}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Bank</p><p className="text-xs text-foreground">{selected.bankName || '—'}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Account</p><p className="text-xs text-foreground font-mono">{selected.bankAccount || '—'}</p></div>
                </div>
              </div>

              {/* Recent POs */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recent Purchase Orders ({relatedPOs(selected.id).length})</span>
                <div className="mt-2 space-y-1.5">
                  {relatedPOs(selected.id).length === 0
                    ? <p className="text-xs text-muted-foreground py-4 text-center">No purchase orders</p>
                    : relatedPOs(selected.id).slice(0, 5).map(po => (
                      <div key={po.id} className="flex items-center justify-between p-2.5 rounded-md bg-muted/20">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-primary">{po.poNumber}</span>
                          <span className="text-[10px] text-muted-foreground">{po.orderDate}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-foreground">${po.total.toFixed(2)}</span>
                          <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full capitalize',
                            po.status === 'completed' ? 'bg-success/10 text-success' :
                            po.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
                            'bg-muted text-muted-foreground'
                          )}>{po.status}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>

              {selected.notes && (
                <div className="p-3.5 rounded-lg bg-muted/30 border">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                  <p className="text-xs text-foreground mt-1.5">{selected.notes}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Supplier' : 'New Supplier'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div><Label className="text-xs">Supplier Name *</Label><Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Company name" className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Legal Name</Label><Input value={formData.legalName} onChange={e => setFormData(p => ({ ...p, legalName: e.target.value }))} placeholder="Legal entity name" className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Contact Name *</Label><Input value={formData.contactName} onChange={e => setFormData(p => ({ ...p, contactName: e.target.value }))} placeholder="Primary contact" className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Phone</Label><Input value={formData.contactPhone} onChange={e => setFormData(p => ({ ...p, contactPhone: e.target.value }))} className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Email</Label><Input value={formData.contactEmail} onChange={e => setFormData(p => ({ ...p, contactEmail: e.target.value }))} className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Payment Terms</Label><Input value={formData.paymentTerms} onChange={e => setFormData(p => ({ ...p, paymentTerms: e.target.value }))} placeholder="e.g. Net 30" className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Tax ID</Label><Input value={formData.taxId} onChange={e => setFormData(p => ({ ...p, taxId: e.target.value }))} placeholder="Tax registration number" className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Bank Name</Label><Input value={formData.bankName} onChange={e => setFormData(p => ({ ...p, bankName: e.target.value }))} className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Bank Account</Label><Input value={formData.bankAccount} onChange={e => setFormData(p => ({ ...p, bankAccount: e.target.value }))} className="h-9 mt-1.5" /></div>
            <div><Label className="text-xs">Address</Label><Input value={formData.address} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} placeholder="Full address" className="h-9 mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave}>{editingId ? 'Update' : 'Create'} Supplier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Supplier</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone. All related data will be permanently removed.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
