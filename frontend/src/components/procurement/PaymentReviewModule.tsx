import { useState, useMemo } from 'react';
import {
  Search, CreditCard, AlertTriangle, CheckCircle2, Ban, Banknote, ChevronRight, Plus, Pencil, Trash2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { mockPayments, PAYMENT_STATUS_CONFIG, PAYMENT_METHOD_CONFIG } from '@/data/mock-procurement-w2';
import { mockSuppliers } from '@/data/mock-procurement';
import type { SupplierPayment, PaymentMethod } from '@/types/procurement';
import { toast } from 'sonner';

const emptyPayment = (): SupplierPayment => ({
  id: '', paymentNumber: '', supplierId: '', supplierName: '',
  invoiceIds: [], invoiceNumbers: [], totalAmount: 0,
  method: 'bank_transfer', paymentDate: new Date().toISOString().slice(0, 10),
  status: 'pending_review', preparedBy: '', createdAt: new Date().toISOString(),
});

export function PaymentReviewModule() {
  const [payments, setPayments] = useState<SupplierPayment[]>(mockPayments);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<SupplierPayment | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // CRUD state
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<SupplierPayment>(emptyPayment());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [invoiceInput, setInvoiceInput] = useState('');

  const filtered = useMemo(() => payments.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.paymentNumber.toLowerCase().includes(q) ||
        p.supplierName.toLowerCase().includes(q) ||
        p.invoiceNumbers.some(n => n.toLowerCase().includes(q));
    }
    return true;
  }), [payments, search, statusFilter]);

  const kpis = useMemo(() => {
    const pending = payments.filter(p => p.status === 'pending_review');
    const approved = payments.filter(p => p.status === 'approved');
    const processed = payments.filter(p => p.status === 'processed');
    return [
      { label: 'Pending Review', value: pending.length, sub: `$${pending.reduce((s, p) => s + p.totalAmount, 0).toFixed(2)}`, color: pending.length > 0 ? 'text-warning' : 'text-foreground' },
      { label: 'Approved', value: approved.length, sub: `$${approved.reduce((s, p) => s + p.totalAmount, 0).toFixed(2)}`, color: 'text-success' },
      { label: 'Processed', value: processed.length, sub: `$${processed.reduce((s, p) => s + p.totalAmount, 0).toFixed(2)}`, color: 'text-primary' },
      { label: 'Total Payments', value: payments.length, sub: `$${payments.reduce((s, p) => s + p.totalAmount, 0).toFixed(2)}`, color: 'text-foreground' },
    ];
  }, [payments]);

  /* ── CRUD handlers ── */
  const openCreate = () => {
    setEditingId(null);
    const nextNum = `PAY-2026-${String(payments.length + 20).padStart(4, '0')}`;
    setFormData({ ...emptyPayment(), id: `pay-${Date.now()}`, paymentNumber: nextNum });
    setInvoiceInput('');
    setFormOpen(true);
  };

  const openEdit = (pay: SupplierPayment) => {
    setEditingId(pay.id);
    setFormData(JSON.parse(JSON.stringify(pay)));
    setInvoiceInput(pay.invoiceNumbers.join(', '));
    setFormOpen(true);
    setSelected(null);
  };

  const handleSave = () => {
    if (!formData.paymentNumber.trim() || !formData.supplierId || formData.totalAmount <= 0) return;
    const invNums = invoiceInput.split(',').map(s => s.trim()).filter(Boolean);
    const data = { ...formData, invoiceNumbers: invNums, invoiceIds: invNums.map((_, i) => `inv-auto-${i}`) };
    if (editingId) {
      setPayments(prev => prev.map(p => p.id === editingId ? data : p));
      toast.success('Payment updated');
    } else {
      setPayments(prev => [...prev, data]);
      toast.success('Payment created');
    }
    setFormOpen(false);
  };

  const handleDelete = (id: string) => {
    setPayments(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
    setSelected(null);
    toast.success('Payment deleted');
  };

  /* ── Workflow handlers ── */
  const handleApprove = (pay: SupplierPayment) => {
    setPayments(prev => prev.map(p => p.id === pay.id ? { ...p, status: 'approved', reviewedBy: 'Current User', reviewedAt: new Date().toISOString() } : p));
    setSelected(null);
    toast.success('Payment approved');
  };

  const handleProcess = (pay: SupplierPayment) => {
    setPayments(prev => prev.map(p => p.id === pay.id ? { ...p, status: 'processed', processedAt: new Date().toISOString() } : p));
    setSelected(null);
    toast.success('Payment marked as processed');
  };

  const handleReject = () => {
    if (!selected || !rejectReason.trim()) return;
    setPayments(prev => prev.map(p => p.id === selected.id ? { ...p, status: 'rejected', rejectionReason: rejectReason, reviewedBy: 'Current User', reviewedAt: new Date().toISOString() } : p));
    setRejectOpen(false);
    setRejectReason('');
    setSelected(null);
    toast.success('Payment rejected');
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Supplier Payment Review</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Review and authorize outgoing supplier payments</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New Payment</Button>
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
          <Input placeholder="Search payment, supplier, invoice…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        {(['all', ...Object.keys(PAYMENT_STATUS_CONFIG)] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
            )}>{s === 'all' ? 'All' : PAYMENT_STATUS_CONFIG[s]?.label || s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Payment #', 'Supplier', 'Invoice(s)', 'Method', 'Date', 'Amount', 'Status', 'Prepared By', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap', h === 'Amount' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No payments found</p>
              </td></tr>
            ) : filtered.map(pay => {
              const sCfg = PAYMENT_STATUS_CONFIG[pay.status];
              const mCfg = PAYMENT_METHOD_CONFIG[pay.method];
              return (
                <tr key={pay.id} onClick={() => setSelected(pay)}
                  className={cn('border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors',
                    selected?.id === pay.id && 'bg-primary/5',
                    pay.status === 'rejected' && 'bg-destructive/[0.02]',
                  )}>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground whitespace-nowrap">{pay.paymentNumber}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{pay.supplierName}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {pay.invoiceNumbers.map(n => (
                        <span key={n} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', mCfg.class)}>{mCfg.label}</span></td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">{pay.paymentDate}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium text-foreground">${pay.totalAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', sCfg.class)}>{sCfg.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{pay.preparedBy}</td>
                  <td className="px-4 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[10px] text-muted-foreground">Showing {filtered.length} of {payments.length} payments</span>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', PAYMENT_STATUS_CONFIG[selected.status].class)}>{PAYMENT_STATUS_CONFIG[selected.status].label}</span>}
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', PAYMENT_METHOD_CONFIG[selected.method].class)}>{PAYMENT_METHOD_CONFIG[selected.method].label}</span>}
            </div>
            <SheetTitle className="text-base">{selected?.paymentNumber}</SheetTitle>
            <SheetDescription>{selected?.supplierName}</SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="p-6 space-y-6">
              {/* Actions row */}
              {(selected.status === 'pending_review') && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => openEdit(selected)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteConfirm(selected.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                </div>
              )}

              {/* Amount Hero */}
              <div className="p-4 rounded-lg bg-muted/20 border text-center">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Payment Amount</span>
                <p className="text-2xl font-semibold text-foreground mt-1">${selected.totalAmount.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{PAYMENT_METHOD_CONFIG[selected.method].label}</p>
              </div>

              {/* Context Grid */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Payment Details</span>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    ['Payment Date', selected.paymentDate],
                    ['Prepared By', selected.preparedBy],
                    ['Reviewed By', selected.reviewedBy || '—'],
                    ['Reviewed At', selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString() : '—'],
                    ...(selected.bankRef ? [['Bank Ref', selected.bankRef]] : []),
                    ...(selected.chequeNumber ? [['Cheque #', selected.chequeNumber]] : []),
                    ...(selected.processedAt ? [['Processed At', new Date(selected.processedAt).toLocaleString()]] : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className={cn('text-xs font-medium text-foreground mt-0.5', (label === 'Bank Ref' || label === 'Cheque #') && 'font-mono text-[11px]')}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Invoices */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Linked Invoices</span>
                <div className="mt-2 space-y-2">
                  {selected.invoiceNumbers.map(n => (
                    <div key={n} className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/10">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs font-medium text-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selected.notes && (
                <div className="p-3.5 rounded-lg bg-muted/30 border">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                  <p className="text-xs text-foreground mt-1.5 leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {selected.rejectionReason && (
                <div className="p-3.5 rounded-lg border border-destructive/20 bg-destructive/5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Ban className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Rejection Reason</span>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">{selected.rejectionReason}</p>
                </div>
              )}

              {/* Review Actions */}
              {selected.status === 'pending_review' && (
                <div className="flex items-center gap-2 pt-2">
                  <Button className="flex-1 h-9 text-xs gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={() => handleApprove(selected)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve Payment
                  </Button>
                  <Button variant="outline" className="flex-1 h-9 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setRejectOpen(true)}>
                    <Ban className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              )}
              {selected.status === 'approved' && (
                <Button className="w-full h-9 text-xs gap-1.5" onClick={() => handleProcess(selected)}>
                  <Banknote className="h-3.5 w-3.5" /> Mark as Processed
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={open => { if (!open) setFormOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Payment' : 'Create Payment'}</DialogTitle>
            <DialogDescription>{editingId ? 'Update payment details.' : 'Enter supplier payment details.'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Number</Label>
                <Input value={formData.paymentNumber} onChange={e => setFormData(prev => ({ ...prev, paymentNumber: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Supplier</Label>
                <Select value={formData.supplierId} onValueChange={v => {
                  const sup = mockSuppliers.find(s => s.id === v);
                  if (sup) setFormData(prev => ({ ...prev, supplierId: sup.id, supplierName: sup.name }));
                }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select supplier…" /></SelectTrigger>
                  <SelectContent>
                    {mockSuppliers.filter(s => s.status === 'active').map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount</Label>
                <Input type="number" value={formData.totalAmount} onChange={e => setFormData(prev => ({ ...prev, totalAmount: +e.target.value }))} className="h-8 text-sm" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Method</Label>
                <Select value={formData.method} onValueChange={v => setFormData(prev => ({ ...prev, method: v as PaymentMethod }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Date</Label>
                <Input type="date" value={formData.paymentDate} onChange={e => setFormData(prev => ({ ...prev, paymentDate: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Prepared By</Label>
                <Input value={formData.preparedBy} onChange={e => setFormData(prev => ({ ...prev, preparedBy: e.target.value }))} placeholder="Name…" className="h-8 text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Linked Invoice Numbers</Label>
              <Input value={invoiceInput} onChange={e => setInvoiceInput(e.target.value)} placeholder="INV-2026-0041, INV-2026-0042" className="h-8 text-sm" />
              <p className="text-[10px] text-muted-foreground">Comma-separated invoice numbers</p>
            </div>

            {formData.method === 'bank_transfer' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Bank Reference</Label>
                <Input value={formData.bankRef || ''} onChange={e => setFormData(prev => ({ ...prev, bankRef: e.target.value }))} placeholder="DBS-TXN-…" className="h-8 text-sm" />
              </div>
            )}
            {formData.method === 'cheque' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Cheque Number</Label>
                <Input value={formData.chequeNumber || ''} onChange={e => setFormData(prev => ({ ...prev, chequeNumber: e.target.value }))} placeholder="CHQ-…" className="h-8 text-sm" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <textarea value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!formData.paymentNumber.trim() || !formData.supplierId || formData.totalAmount <= 0} onClick={handleSave}>
              {editingId ? 'Update Payment' : 'Create Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={open => { if (!open) { setRejectOpen(false); setRejectReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-destructive">Reject Payment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Provide a reason for rejecting {selected?.paymentNumber}.</p>
          <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setRejectOpen(false); setRejectReason(''); }}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" disabled={!rejectReason.trim()} onClick={handleReject}>Reject Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">Delete Payment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this payment? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
