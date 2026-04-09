import { useState, useMemo } from 'react';
import {
  Search, AlertTriangle, CheckCircle2, FileText, ArrowRight, ChevronRight, Plus, Pencil, Trash2,
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
import { mockInvoices, INVOICE_STATUS_CONFIG } from '@/data/mock-procurement-w2';
import { mockSuppliers } from '@/data/mock-procurement';
import type { SupplierInvoice, InvoiceLineItem } from '@/types/procurement';
import { toast } from 'sonner';

const emptyLine = (): InvoiceLineItem => ({
  id: `il-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  itemName: '', unit: 'kg', grQty: 0, invoicedQty: 0, unitPrice: 0, lineTotal: 0, variance: 0,
});

const emptyInvoice = (): SupplierInvoice => ({
  id: '', invoiceNumber: '', supplierInvoiceRef: '', supplierId: '', supplierName: '',
  poId: '', poNumber: '', grId: '', grNumber: '', outletId: '', outletName: '',
  invoiceDate: new Date().toISOString().slice(0, 10), dueDate: '', status: 'pending_review',
  subtotal: 0, taxAmount: 0, total: 0, lines: [emptyLine()], createdAt: new Date().toISOString(),
});

export function InvoiceReviewModule() {
  const [invoices, setInvoices] = useState<SupplierInvoice[]>(mockInvoices);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<SupplierInvoice | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  // CRUD state
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<SupplierInvoice>(emptyInvoice());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = useMemo(() => invoices.filter(inv => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.supplierName.toLowerCase().includes(q) ||
        inv.supplierInvoiceRef.toLowerCase().includes(q) ||
        inv.poNumber.toLowerCase().includes(q);
    }
    return true;
  }), [invoices, search, statusFilter]);

  const kpis = useMemo(() => {
    const pending = invoices.filter(i => i.status === 'pending_review');
    const disputed = invoices.filter(i => i.status === 'disputed');
    const totalPending = pending.reduce((s, i) => s + i.total, 0);
    return [
      { label: 'Pending Review', value: pending.length, sub: `$${totalPending.toFixed(2)}`, color: pending.length > 0 ? 'text-warning' : 'text-foreground' },
      { label: 'Disputed', value: disputed.length, sub: `$${disputed.reduce((s, i) => s + i.total, 0).toFixed(2)}`, color: disputed.length > 0 ? 'text-destructive' : 'text-foreground' },
      { label: 'Approved', value: invoices.filter(i => i.status === 'approved').length, sub: 'ready for payment', color: 'text-success' },
      { label: 'Total Invoices', value: invoices.length, sub: `$${invoices.reduce((s, i) => s + i.total, 0).toFixed(2)}`, color: 'text-foreground' },
    ];
  }, [invoices]);

  const hasVariance = (inv: SupplierInvoice) => inv.lines.some(l => l.variance !== 0);

  /* ── CRUD handlers ── */
  const openCreate = () => {
    setEditingId(null);
    const nextNum = `INV-2026-${String(invoices.length + 50).padStart(4, '0')}`;
    setFormData({ ...emptyInvoice(), id: `inv-${Date.now()}`, invoiceNumber: nextNum });
    setFormOpen(true);
  };

  const openEdit = (inv: SupplierInvoice) => {
    setEditingId(inv.id);
    setFormData(JSON.parse(JSON.stringify(inv)));
    setFormOpen(true);
    setSelected(null);
  };

  const recalcTotals = (lines: InvoiceLineItem[]) => {
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const taxAmount = subtotal * 0.08;
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  };

  const updateFormLine = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setFormData(prev => {
      const lines = [...prev.lines];
      const updated = { ...lines[idx], ...patch };
      updated.lineTotal = updated.invoicedQty * updated.unitPrice;
      updated.variance = (updated.invoicedQty - updated.grQty) * updated.unitPrice;
      lines[idx] = updated;
      return { ...prev, lines, ...recalcTotals(lines) };
    });
  };

  const addFormLine = () => setFormData(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  const removeFormLine = (idx: number) => {
    setFormData(prev => {
      const lines = prev.lines.filter((_, i) => i !== idx);
      return { ...prev, lines, ...recalcTotals(lines) };
    });
  };

  const handleSave = () => {
    if (!formData.invoiceNumber.trim() || !formData.supplierId) return;
    if (editingId) {
      setInvoices(prev => prev.map(i => i.id === editingId ? { ...formData } : i));
      toast.success('Invoice updated');
    } else {
      setInvoices(prev => [...prev, formData]);
      toast.success('Invoice created');
    }
    setFormOpen(false);
  };

  const handleDelete = (id: string) => {
    setInvoices(prev => prev.filter(i => i.id !== id));
    setDeleteConfirm(null);
    setSelected(null);
    toast.success('Invoice deleted');
  };

  /* ── Workflow handlers ── */
  const handleApprove = (inv: SupplierInvoice) => {
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'approved', reviewedBy: 'Current User', reviewedAt: new Date().toISOString() } : i));
    setSelected(null);
    toast.success('Invoice approved');
  };

  const handleDispute = () => {
    if (!selected || !disputeReason.trim()) return;
    setInvoices(prev => prev.map(i => i.id === selected.id ? { ...i, status: 'disputed', disputeReason } : i));
    setDisputeOpen(false);
    setDisputeReason('');
    setSelected(null);
    toast.success('Invoice disputed');
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Invoice Review</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Three-way match verification — PO → GR → Invoice</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New Invoice</Button>
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
          <Input placeholder="Search invoice, supplier, PO…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        {(['all', ...Object.keys(INVOICE_STATUS_CONFIG)] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
            )}>{s === 'all' ? 'All' : INVOICE_STATUS_CONFIG[s]?.label || s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Invoice #', 'Supplier Ref', 'Supplier', 'PO / GR', 'Date', 'Due', 'Total', 'Status', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap', h === 'Total' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No invoices found</p>
              </td></tr>
            ) : filtered.map(inv => {
              const sCfg = INVOICE_STATUS_CONFIG[inv.status];
              const vFlag = hasVariance(inv);
              return (
                <tr key={inv.id} onClick={() => setSelected(inv)}
                  className={cn('border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors',
                    selected?.id === inv.id && 'bg-primary/5',
                    inv.status === 'disputed' && 'bg-destructive/[0.02]',
                  )}>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground whitespace-nowrap">{inv.invoiceNumber}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">{inv.supplierInvoiceRef}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{inv.supplierName}</td>
                  <td className="px-4 py-2.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{inv.poNumber}</span>
                    <span className="mx-1 text-muted-foreground/40">→</span>
                    <span className="font-mono">{inv.grNumber}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">{inv.invoiceDate}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">{inv.dueDate}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-medium text-foreground">${inv.total.toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', sCfg.class)}>{sCfg.label}</span>
                      {vFlag && <AlertTriangle className="h-3 w-3 text-warning" />}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[10px] text-muted-foreground">Showing {filtered.length} of {invoices.length} invoices</span>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', INVOICE_STATUS_CONFIG[selected.status].class)}>{INVOICE_STATUS_CONFIG[selected.status].label}</span>}
              {selected && hasVariance(selected) && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning">Variance</span>}
            </div>
            <SheetTitle className="text-base">{selected?.invoiceNumber}</SheetTitle>
            <SheetDescription>{selected?.supplierName} · Ref: {selected?.supplierInvoiceRef}</SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="p-6 space-y-6">
              {/* Actions row */}
              {(selected.status === 'pending_review' || selected.status === 'disputed') && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => openEdit(selected)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteConfirm(selected.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                </div>
              )}

              {/* Document Chain */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/20 border text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="font-mono text-[11px] font-medium">{selected.poNumber}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[11px] font-medium">{selected.grNumber}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[11px] font-medium text-primary">{selected.invoiceNumber}</span>
              </div>

              {/* Context Grid */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Invoice Details</span>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    ['Invoice Date', selected.invoiceDate],
                    ['Due Date', selected.dueDate],
                    ['Outlet', selected.outletName],
                    ['Supplier Ref', selected.supplierInvoiceRef],
                    ['Reviewed By', selected.reviewedBy || '—'],
                    ['Reviewed At', selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString() : '—'],
                  ].map(([label, value]) => (
                    <div key={label}><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-xs font-medium text-foreground mt-0.5">{value}</p></div>
                  ))}
                </div>
              </div>

              {/* Line Items */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Line Items</span>
                <div className="mt-2 rounded-lg border overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        {['Item', 'GR Qty', 'Inv Qty', 'Price', 'Total', 'Var'].map(h => (
                          <th key={h} className={cn('text-[10px] font-medium text-muted-foreground px-3 py-2', ['GR Qty', 'Inv Qty', 'Price', 'Total', 'Var'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.lines.map(line => (
                        <tr key={line.id} className={cn('border-b last:border-0', line.variance !== 0 && 'bg-warning/[0.03]')}>
                          <td className="px-3 py-2 text-xs font-medium text-foreground">{line.itemName}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">{line.grQty} {line.unit}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-foreground">{line.invoicedQty} {line.unit}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">${line.unitPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] font-medium text-foreground">${line.lineTotal.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            {line.variance !== 0
                              ? <span className="font-mono text-[10px] font-medium text-warning">${line.variance.toFixed(2)}</span>
                              : <span className="text-[10px] text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="p-3.5 rounded-lg bg-muted/20 border space-y-1.5">
                {[['Subtotal', `$${selected.subtotal.toFixed(2)}`], ['Tax (8%)', `$${selected.taxAmount.toFixed(2)}`], ['Total', `$${selected.total.toFixed(2)}`]].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={cn('font-mono font-medium', label === 'Total' ? 'text-foreground text-sm' : 'text-muted-foreground')}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Dispute Reason */}
              {selected.disputeReason && (
                <div className="p-3.5 rounded-lg border border-destructive/20 bg-destructive/5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Dispute Reason</span>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">{selected.disputeReason}</p>
                </div>
              )}

              {/* Review Actions */}
              {selected.status === 'pending_review' && (
                <div className="flex items-center gap-2 pt-2">
                  <Button className="flex-1 h-9 text-xs gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={() => handleApprove(selected)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve Invoice
                  </Button>
                  <Button variant="outline" className="flex-1 h-9 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDisputeOpen(true)}>
                    <AlertTriangle className="h-3.5 w-3.5" /> Dispute
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={open => { if (!open) setFormOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Invoice' : 'Create Invoice'}</DialogTitle>
            <DialogDescription>{editingId ? 'Update invoice details and line items.' : 'Enter supplier invoice details and line items.'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Invoice Number</Label>
                <Input value={formData.invoiceNumber} onChange={e => setFormData(prev => ({ ...prev, invoiceNumber: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Supplier Ref</Label>
                <Input value={formData.supplierInvoiceRef} onChange={e => setFormData(prev => ({ ...prev, supplierInvoiceRef: e.target.value }))} placeholder="e.g. FF-8821" className="h-8 text-sm" />
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
                <Label className="text-xs">PO Number</Label>
                <Input value={formData.poNumber} onChange={e => setFormData(prev => ({ ...prev, poNumber: e.target.value }))} placeholder="PO-2026-…" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">GR Number</Label>
                <Input value={formData.grNumber} onChange={e => setFormData(prev => ({ ...prev, grNumber: e.target.value }))} placeholder="GR-…" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Outlet</Label>
                <Input value={formData.outletName} onChange={e => setFormData(prev => ({ ...prev, outletName: e.target.value }))} placeholder="Outlet name" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" value={formData.invoiceDate} onChange={e => setFormData(prev => ({ ...prev, invoiceDate: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={formData.dueDate} onChange={e => setFormData(prev => ({ ...prev, dueDate: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Line Items</span>
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={addFormLine}><Plus className="h-3 w-3" /> Add Line</Button>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      {['Item', 'Unit', 'GR Qty', 'Inv Qty', 'Price', 'Total', ''].map(h => (
                        <th key={h} className="text-[10px] font-medium text-muted-foreground px-3 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formData.lines.map((line, i) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="px-3 py-1.5"><Input value={line.itemName} onChange={e => updateFormLine(i, { itemName: e.target.value })} className="h-7 text-xs" placeholder="Item" /></td>
                        <td className="px-3 py-1.5"><Input value={line.unit} onChange={e => updateFormLine(i, { unit: e.target.value })} className="h-7 text-xs w-14" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.grQty} onChange={e => updateFormLine(i, { grQty: +e.target.value })} className="h-7 text-xs w-16" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.invoicedQty} onChange={e => updateFormLine(i, { invoicedQty: +e.target.value })} className="h-7 text-xs w-16" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.unitPrice} onChange={e => updateFormLine(i, { unitPrice: +e.target.value })} className="h-7 text-xs w-20" step="0.01" /></td>
                        <td className="px-3 py-1.5 text-xs font-mono font-medium text-foreground">${line.lineTotal.toFixed(2)}</td>
                        <td className="px-3 py-1.5">
                          {formData.lines.length > 1 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => removeFormLine(i)}><Trash2 className="h-3 w-3" /></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-right space-y-0.5">
                <p className="text-xs text-muted-foreground">Subtotal: <span className="font-mono font-medium text-foreground">${formData.subtotal.toFixed(2)}</span></p>
                <p className="text-xs text-muted-foreground">Tax (8%): <span className="font-mono font-medium text-foreground">${formData.taxAmount.toFixed(2)}</span></p>
                <p className="text-sm font-medium text-foreground">Total: <span className="font-mono">${formData.total.toFixed(2)}</span></p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <textarea value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!formData.invoiceNumber.trim() || !formData.supplierId} onClick={handleSave}>
              {editingId ? 'Update Invoice' : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute Dialog */}
      <Dialog open={disputeOpen} onOpenChange={open => { if (!open) { setDisputeOpen(false); setDisputeReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-destructive">Dispute Invoice</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Provide a reason for disputing {selected?.invoiceNumber}.</p>
          <textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Dispute reason…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setDisputeOpen(false); setDisputeReason(''); }}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" disabled={!disputeReason.trim()} onClick={handleDispute}>Submit Dispute</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">Delete Invoice</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this invoice? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
