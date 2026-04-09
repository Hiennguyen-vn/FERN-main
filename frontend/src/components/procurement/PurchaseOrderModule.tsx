import { useState, useMemo } from 'react';
import {
  Search, Plus, Edit2, CheckCircle2, XCircle, Clock, Trash2,
  Send, Stamp, FileOutput, Ban, Eye, AlertTriangle, Save, Package,
  ScrollText,
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
import type { POStatus, PurchaseOrder } from '@/types/procurement';
import { mockPurchaseOrders, mockSuppliers, PO_STATUS_CONFIG, PO_STATUS_STEPS } from '@/data/mock-procurement';
import { toast } from 'sonner';

export function PurchaseOrderModule() {
  const [orders, setOrders] = useState<PurchaseOrder[]>(mockPurchaseOrders);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'submit' | 'approve' | 'issue' | 'cancel'; po: PurchaseOrder } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [formData, setFormData] = useState({
    supplierId: '', expectedDelivery: '', notes: '',
    lines: [{ itemName: '', quantity: 0, unit: 'kg', unitPrice: 0 }] as { itemName: string; quantity: number; unit: string; unitPrice: number }[],
  });

  const filtered = useMemo(() => orders.filter(po => {
    if (statusFilter !== 'all' && po.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return po.poNumber.toLowerCase().includes(q) || po.supplierName.toLowerCase().includes(q);
    }
    return true;
  }), [orders, search, statusFilter]);

  const kpis = useMemo(() => {
    const draft = orders.filter(p => p.status === 'draft').length;
    const pending = orders.filter(p => ['submitted', 'approved'].includes(p.status)).length;
    const active = orders.filter(p => ['ordered', 'partially_received'].includes(p.status)).length;
    const totalValue = orders.filter(p => !['cancelled', 'closed'].includes(p.status)).reduce((s, p) => s + p.total, 0);
    return [
      { label: 'Drafts', value: draft, sub: 'awaiting submission', color: draft > 0 ? 'text-muted-foreground' : 'text-foreground' },
      { label: 'Pending Approval', value: pending, sub: 'submitted / approved', color: pending > 0 ? 'text-warning' : 'text-foreground' },
      { label: 'Active Orders', value: active, sub: 'ordered / partial', color: active > 0 ? 'text-primary' : 'text-foreground' },
      { label: 'Open Value', value: `$${totalValue.toFixed(0)}`, sub: `${orders.length} total POs`, color: 'text-foreground' },
    ];
  }, [orders]);

  const openCreate = () => {
    setEditingId(null);
    setFormData({ supplierId: '', expectedDelivery: '', notes: '', lines: [{ itemName: '', quantity: 0, unit: 'kg', unitPrice: 0 }] });
    setFormOpen(true);
  };

  const openEdit = (po: PurchaseOrder) => {
    setEditingId(po.id);
    setFormData({
      supplierId: po.supplierId, expectedDelivery: po.expectedDelivery, notes: po.notes || '',
      lines: po.lines.map(l => ({ itemName: l.itemName, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice })),
    });
    setFormOpen(true);
  };

  const handleSave = () => {
    if (!formData.supplierId || formData.lines.every(l => !l.itemName.trim())) {
      toast.error('Supplier and at least one line item required');
      return;
    }
    const validLines = formData.lines.filter(l => l.itemName.trim());
    const subtotal = validLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const tax = subtotal * 0.08;

    if (editingId) {
      setOrders(prev => prev.map(po => po.id === editingId ? {
        ...po, supplierId: formData.supplierId,
        supplierName: mockSuppliers.find(s => s.id === formData.supplierId)?.name || po.supplierName,
        expectedDelivery: formData.expectedDelivery, notes: formData.notes || undefined,
        lines: validLines.map((l, i) => ({ id: `pol-new-${i}`, ...l, lineTotal: l.quantity * l.unitPrice })),
        subtotal, taxAmount: tax, total: subtotal + tax,
      } : po));
      toast.success('Purchase order updated');
    } else {
      const sup = mockSuppliers.find(s => s.id === formData.supplierId);
      const newPO: PurchaseOrder = {
        id: `po-${Date.now()}`, poNumber: `PO-2026-${String(orders.length + 405).padStart(4, '0')}`,
        outletId: 'outlet-001', outletName: 'Downtown Flagship',
        supplierId: formData.supplierId, supplierName: sup?.name || '—',
        createdBy: 'Current User', createdAt: new Date().toISOString(),
        orderDate: new Date().toISOString().slice(0, 10), expectedDelivery: formData.expectedDelivery,
        status: 'draft',
        lines: validLines.map((l, i) => ({ id: `pol-new-${i}`, ...l, lineTotal: l.quantity * l.unitPrice })),
        subtotal, taxAmount: tax, total: subtotal + tax,
        notes: formData.notes || undefined,
      };
      setOrders(prev => [newPO, ...prev]);
      toast.success('Purchase order created');
    }
    setFormOpen(false);
    setSelected(null);
  };

  const handleDelete = (id: string) => {
    setOrders(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
    setSelected(null);
    toast.success('Purchase order deleted');
  };

  const handleAction = (type: string) => {
    if (!actionModal) return;
    const po = actionModal.po;
    const statusMap: Record<string, POStatus> = { submit: 'submitted', approve: 'approved', issue: 'ordered', cancel: 'cancelled' };
    const newStatus = statusMap[type];
    if (type === 'cancel' && !cancelReason.trim()) { toast.error('Reason required'); return; }
    setOrders(prev => prev.map(p => p.id === po.id ? {
      ...p, status: newStatus,
      ...(type === 'submit' ? { submittedAt: new Date().toISOString() } : {}),
      ...(type === 'approve' ? { approvedAt: new Date().toISOString(), approvedBy: 'Current User' } : {}),
      ...(type === 'issue' ? { issuedAt: new Date().toISOString() } : {}),
      ...(type === 'cancel' ? { cancelledAt: new Date().toISOString(), cancelReason } : {}),
    } : p));
    setSelected(prev => prev?.id === po.id ? { ...prev, status: newStatus } : prev);
    setActionModal(null);
    setCancelReason('');
    toast.success(`PO ${PO_STATUS_CONFIG[newStatus]?.label || newStatus}`);
  };

  const statusIdx = (status: string) => {
    const normalized = PO_STATUS_STEPS.includes(status as (typeof PO_STATUS_STEPS)[number])
      ? (status as (typeof PO_STATUS_STEPS)[number])
      : 'draft';
    return PO_STATUS_STEPS.indexOf(normalized);
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Purchase Orders</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Draft → Submit → Approve → Issue → Receive</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New PO
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <div key={kpi.label} className="surface-elevated p-3.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            <p className={cn('text-xl font-semibold mt-1', kpi.color)}>{typeof kpi.value === 'number' ? kpi.value : kpi.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search PO# or supplier…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'draft', 'submitted', 'approved', 'ordered', 'completed', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
                statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
              )}>{s === 'all' ? 'All' : PO_STATUS_CONFIG[s]?.label || s}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['PO #', 'Outlet', 'Supplier', 'Date', 'Expected', 'Total', 'Status'].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Total' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No purchase orders found</p>
              </td></tr>
            ) : filtered.map(po => {
              const cfg = PO_STATUS_CONFIG[po.status];
              return (
                <tr key={po.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelected(po)}>
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{po.poNumber}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{po.outletName}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{po.supplierName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{po.orderDate}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{po.expectedDelivery}</td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium text-foreground">${po.total.toFixed(2)}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg?.class)}>{cfg?.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[10px] text-muted-foreground">Showing {filtered.length} of {orders.length} purchase orders</span>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', PO_STATUS_CONFIG[selected.status]?.class)}>{PO_STATUS_CONFIG[selected.status]?.label}</span>}
            </div>
            <SheetTitle className="text-base">{selected?.poNumber}</SheetTitle>
            <SheetDescription>{selected?.supplierName} · {selected?.outletName}</SheetDescription>
          </SheetHeader>

          {selected && (() => {
            const po = selected;
            const isDraft = po.status === 'draft';
            const isSubmitted = po.status === 'submitted';
            const isApproved = po.status === 'approved';
            const isTerminal = po.status === 'cancelled' || po.status === 'closed';
            const sIdx = statusIdx(po.status);

            const timeline = [
              { label: 'Created', actor: po.createdBy, time: po.createdAt },
              ...(po.submittedAt ? [{ label: 'Submitted', actor: po.createdBy, time: po.submittedAt }] : []),
              ...(po.approvedAt ? [{ label: 'Approved', actor: po.approvedBy || '—', time: po.approvedAt }] : []),
              ...(po.issuedAt ? [{ label: 'Issued', actor: po.createdBy, time: po.issuedAt }] : []),
              ...(po.cancelledAt ? [{ label: 'Cancelled', actor: '—', time: po.cancelledAt }] : []),
            ];

            return (
              <div className="p-6 space-y-6">
                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isDraft && <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => openEdit(po)}><Edit2 className="h-3 w-3" /> Edit</Button>}
                  {isDraft && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setActionModal({ type: 'submit', po })}><Send className="h-3.5 w-3.5" /> Submit</Button>}
                  {isSubmitted && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setActionModal({ type: 'approve', po })}><Stamp className="h-3.5 w-3.5" /> Approve</Button>}
                  {isApproved && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setActionModal({ type: 'issue', po })}><FileOutput className="h-3.5 w-3.5" /> Issue</Button>}
                  {!isTerminal && po.status !== 'completed' && (
                    <Button variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setActionModal({ type: 'cancel', po })}>
                      <Ban className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  )}
                  {isDraft && (
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteConfirm(po.id)}>
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  )}
                </div>

                {/* Status progression */}
                {!isTerminal && (
                  <div className="flex items-center gap-0">
                    {PO_STATUS_STEPS.slice(0, 4).map((step, i) => {
                      const reached = sIdx >= i;
                      return (
                        <div key={step} className="flex items-center flex-1">
                          <div className="flex items-center gap-2">
                            <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium',
                              reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            )}>
                              {reached ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                            </div>
                            <span className={cn('text-xs', reached ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                              {PO_STATUS_CONFIG[step]?.label}
                            </span>
                          </div>
                          {i < 3 && <div className={cn('flex-1 h-px mx-3', reached && sIdx > i ? 'bg-primary' : 'bg-border')} />}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Cancel reason */}
                {po.status === 'cancelled' && po.cancelReason && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10">
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 flex-shrink-0" />
                    <div><p className="text-[11px] font-medium text-destructive">Cancelled</p><p className="text-[11px] text-muted-foreground">{po.cancelReason}</p></div>
                  </div>
                )}

                {/* Info cards */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Order Date', po.orderDate],
                    ['Expected Delivery', po.expectedDelivery],
                    ['Created By', po.createdBy],
                    ['Total', `$${po.total.toFixed(2)}`],
                  ].map(([label, value]) => (
                    <div key={label} className="p-3 rounded-lg bg-muted/20 border">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                      <p className={cn('text-sm font-medium text-foreground mt-1', label === 'Total' && 'text-lg font-semibold')}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Line items */}
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Line Items</span>
                  <div className="mt-2 rounded-lg border overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          {['Item', 'Qty', 'Unit', 'Price', 'Total'].map(h => (
                            <th key={h} className={cn('text-[10px] font-medium text-muted-foreground px-3 py-2', ['Qty', 'Price', 'Total'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {po.lines.map(line => (
                          <tr key={line.id} className="border-b last:border-0">
                            <td className="px-3 py-2 text-xs font-medium text-foreground">{line.itemName}</td>
                            <td className="px-3 py-2 text-right text-xs text-foreground">{line.quantity}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{line.unit}</td>
                            <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">${line.unitPrice.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-[11px] font-medium text-foreground">${line.lineTotal.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 p-3 rounded-lg bg-muted/20 border space-y-1">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Subtotal</span><span className="font-mono text-muted-foreground">${po.subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Tax (8%)</span><span className="font-mono text-muted-foreground">${po.taxAmount.toFixed(2)}</span></div>
                    <div className="flex justify-between text-sm font-semibold border-t pt-1"><span className="text-foreground">Total</span><span className="font-mono text-foreground">${po.total.toFixed(2)}</span></div>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Activity</span>
                  <div className="mt-2 relative">
                    <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
                    <div className="space-y-3">
                      {[...timeline].reverse().map((ev, i) => (
                        <div key={i} className="flex items-start gap-3 relative">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center z-10 border-2 border-background flex-shrink-0">
                            <ScrollText className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-foreground">{ev.label}</p>
                            <p className="text-[10px] text-muted-foreground">{ev.actor} · {new Date(ev.time).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Purchase Order' : 'New Purchase Order'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label className="text-xs">Supplier *</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1.5 h-9" value={formData.supplierId} onChange={e => setFormData(p => ({ ...p, supplierId: e.target.value }))}>
                <option value="">Select supplier…</option>
                {mockSuppliers.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Expected Delivery *</Label>
              <Input type="date" value={formData.expectedDelivery} onChange={e => setFormData(p => ({ ...p, expectedDelivery: e.target.value }))} className="h-9 mt-1.5" />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold">Line Items</Label>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => setFormData(p => ({ ...p, lines: [...p.lines, { itemName: '', quantity: 0, unit: 'kg', unitPrice: 0 }] }))}>
                <Plus className="h-3 w-3 mr-1" /> Add Line
              </Button>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    {['Item', 'Qty', 'Unit', 'Price', 'Total', ''].map(h => (
                      <th key={h} className="text-[10px] font-medium text-muted-foreground px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {formData.lines.map((line, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5"><Input value={line.itemName} onChange={e => { const l = [...formData.lines]; l[i] = { ...l[i], itemName: e.target.value }; setFormData(p => ({ ...p, lines: l })); }} placeholder="Item name" className="h-7 text-xs" /></td>
                      <td className="px-3 py-1.5"><Input type="number" value={line.quantity || ''} onChange={e => { const l = [...formData.lines]; l[i] = { ...l[i], quantity: +e.target.value }; setFormData(p => ({ ...p, lines: l })); }} className="h-7 text-xs w-20" /></td>
                      <td className="px-3 py-1.5"><Input value={line.unit} onChange={e => { const l = [...formData.lines]; l[i] = { ...l[i], unit: e.target.value }; setFormData(p => ({ ...p, lines: l })); }} className="h-7 text-xs w-16" /></td>
                      <td className="px-3 py-1.5"><Input type="number" step="0.01" value={line.unitPrice || ''} onChange={e => { const l = [...formData.lines]; l[i] = { ...l[i], unitPrice: +e.target.value }; setFormData(p => ({ ...p, lines: l })); }} className="h-7 text-xs w-24" /></td>
                      <td className="px-3 py-1.5 text-xs font-medium text-foreground">${(line.quantity * line.unitPrice).toFixed(2)}</td>
                      <td className="px-3 py-1.5">
                        {formData.lines.length > 1 && (
                          <button onClick={() => setFormData(p => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80">
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave}>{editingId ? 'Update' : 'Create'} PO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Modal */}
      {actionModal && (
        <Dialog open onOpenChange={() => { setActionModal(null); setCancelReason(''); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className={actionModal.type === 'cancel' ? 'text-destructive' : ''}>
                {actionModal.type === 'submit' ? 'Submit Purchase Order' : actionModal.type === 'approve' ? 'Approve Purchase Order' : actionModal.type === 'issue' ? 'Issue Purchase Order' : 'Cancel Purchase Order'}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {actionModal.type === 'submit' ? `Submit ${actionModal.po.poNumber} for approval?` :
               actionModal.type === 'approve' ? `Approve ${actionModal.po.poNumber}? It will be ready for issuance.` :
               actionModal.type === 'issue' ? `Issue ${actionModal.po.poNumber} to ${actionModal.po.supplierName}? This locks the commercial snapshot.` :
               `Cancel ${actionModal.po.poNumber}? This action cannot be undone.`}
            </p>
            {actionModal.type === 'issue' && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-info/5 border border-info/10">
                <Eye className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-info">After issuance, line items and pricing cannot be modified.</p>
              </div>
            )}
            {actionModal.type === 'cancel' && (
              <div>
                <Label className="text-xs">Reason *</Label>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none mt-1.5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setActionModal(null); setCancelReason(''); }}>Cancel</Button>
              <Button variant={actionModal.type === 'cancel' ? 'destructive' : 'default'} size="sm" className="h-8 text-xs"
                disabled={actionModal.type === 'cancel' && !cancelReason.trim()}
                onClick={() => handleAction(actionModal.type)}>
                {actionModal.type === 'submit' ? 'Submit PO' : actionModal.type === 'approve' ? 'Approve' : actionModal.type === 'issue' ? 'Issue to Supplier' : 'Cancel PO'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">Delete Purchase Order</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete this draft PO.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
