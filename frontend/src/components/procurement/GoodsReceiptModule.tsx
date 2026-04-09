import { useState, useMemo } from 'react';
import {
  Search, CheckCircle2, AlertTriangle, Truck, Send, Eye, Plus, Pencil, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { GRStatus, GoodsReceipt, GRLineItem } from '@/types/procurement';
import { mockGoodsReceipts, mockPurchaseOrders, GR_STATUS_CONFIG } from '@/data/mock-procurement';
import { toast } from 'sonner';

const GR_STATUS_STEPS = ['draft', 'received', 'posted'] as const;

const emptyLine = (): GRLineItem => ({
  id: `grl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  itemName: '', unit: 'kg', orderedQty: 0, previouslyReceived: 0, receivingNow: 0, damagedQty: 0, variance: 0,
});

const emptyGR = (): GoodsReceipt => ({
  id: '', grNumber: '', poId: '', poNumber: '', supplierId: '', supplierName: '',
  outletId: '', outletName: '', receivedBy: '', receiptDate: new Date().toISOString().slice(0, 10),
  status: 'draft', lines: [emptyLine()], notes: '',
});

export function GoodsReceiptModule() {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>(mockGoodsReceipts);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<GRStatus | 'all'>('all');
  const [selected, setSelected] = useState<GoodsReceipt | null>(null);

  // CRUD state
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<GoodsReceipt>(emptyGR());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Workflow state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivingGR, setReceivingGR] = useState<GoodsReceipt | null>(null);
  const [postConfirm, setPostConfirm] = useState<string | null>(null);

  const filtered = useMemo(() => receipts.filter(gr => {
    if (statusFilter !== 'all' && gr.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return gr.grNumber.toLowerCase().includes(q) || gr.supplierName.toLowerCase().includes(q) || gr.poNumber.toLowerCase().includes(q);
    }
    return true;
  }), [receipts, search, statusFilter]);

  const kpis = useMemo(() => {
    const draft = receipts.filter(g => g.status === 'draft').length;
    const received = receipts.filter(g => g.status === 'received').length;
    const posted = receipts.filter(g => g.status === 'posted').length;
    const totalDamaged = receipts.reduce((s, g) => s + g.lines.reduce((ls, l) => ls + l.damagedQty, 0), 0);
    return [
      { label: 'Draft', value: draft, sub: 'pending receiving', color: draft > 0 ? 'text-muted-foreground' : 'text-foreground' },
      { label: 'Received', value: received, sub: 'awaiting posting', color: received > 0 ? 'text-info' : 'text-foreground' },
      { label: 'Posted', value: posted, sub: 'inventory updated', color: 'text-success' },
      { label: 'Damaged Items', value: totalDamaged, sub: 'across all GRs', color: totalDamaged > 0 ? 'text-warning' : 'text-foreground' },
    ];
  }, [receipts]);

  /* ── CRUD handlers ── */
  const openCreate = () => {
    setEditingId(null);
    const nextNum = `GR-${String(receipts.length + 1).padStart(4, '0')}`;
    setFormData({ ...emptyGR(), id: `gr-${Date.now()}`, grNumber: nextNum });
    setFormOpen(true);
  };

  const openEdit = (gr: GoodsReceipt) => {
    setEditingId(gr.id);
    setFormData(JSON.parse(JSON.stringify(gr)));
    setFormOpen(true);
    setSelected(null);
  };

  const handleSave = () => {
    if (!formData.grNumber.trim() || !formData.poId) return;
    if (editingId) {
      setReceipts(prev => prev.map(g => g.id === editingId ? { ...formData } : g));
      toast.success('Goods receipt updated');
    } else {
      setReceipts(prev => [...prev, formData]);
      toast.success('Goods receipt created');
    }
    setFormOpen(false);
  };

  const handleDelete = (id: string) => {
    setReceipts(prev => prev.filter(g => g.id !== id));
    setDeleteConfirm(null);
    setSelected(null);
    toast.success('Goods receipt deleted');
  };

  const handlePoSelect = (poId: string) => {
    const po = mockPurchaseOrders.find(p => p.id === poId);
    if (!po) return;
    setFormData(prev => ({
      ...prev,
      poId: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      outletId: po.outletId,
      outletName: po.outletName,
      lines: po.lines.map(l => ({
        id: `grl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        itemName: l.itemName,
        unit: l.unit,
        orderedQty: l.quantity,
        previouslyReceived: 0,
        receivingNow: l.quantity,
        damagedQty: 0,
        variance: 0,
      })),
    }));
  };

  const updateFormLine = (idx: number, patch: Partial<GRLineItem>) => {
    setFormData(prev => {
      const lines = [...prev.lines];
      lines[idx] = { ...lines[idx], ...patch };
      return { ...prev, lines };
    });
  };

  const addFormLine = () => setFormData(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  const removeFormLine = (idx: number) => setFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));

  /* ── Workflow handlers ── */
  const startReceive = (gr: GoodsReceipt) => {
    setReceivingGR(JSON.parse(JSON.stringify(gr)));
    setReceiveOpen(true);
  };

  const handleReceive = () => {
    if (!receivingGR) return;
    setReceipts(prev => prev.map(g => g.id === receivingGR.id ? { ...receivingGR, status: 'received' as GRStatus } : g));
    setReceiveOpen(false);
    setSelected(null);
    toast.success('Goods received successfully');
  };

  const handlePost = (id: string) => {
    setReceipts(prev => prev.map(g => g.id === id ? { ...g, status: 'posted' as GRStatus, postedAt: new Date().toISOString() } : g));
    setPostConfirm(null);
    setSelected(null);
    toast.success('Goods receipt posted — inventory updated');
  };

  const sIdx = (status: string) => GR_STATUS_STEPS.indexOf(status as (typeof GR_STATUS_STEPS)[number]);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Goods Receipts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Receive and verify deliveries against purchase orders</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New GR</Button>
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
          <Input placeholder="Search GR#, PO# or supplier…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        {(['all', 'draft', 'received', 'posted', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
            )}>{s === 'all' ? 'All' : GR_STATUS_CONFIG[s]?.label || s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['GR #', 'Linked PO', 'Supplier', 'Outlet', 'Receipt Date', 'Status', 'Posted'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No goods receipts found</p>
              </td></tr>
            ) : filtered.map(gr => {
              const cfg = GR_STATUS_CONFIG[gr.status];
              return (
                <tr key={gr.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelected(gr)}>
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{gr.grNumber}</td>
                  <td className="px-4 py-2.5 text-xs text-primary font-medium">{gr.poNumber}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{gr.supplierName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{gr.outletName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{gr.receiptDate}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg?.class)}>{cfg?.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{gr.postedAt ? new Date(gr.postedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border bg-muted/10">
          <span className="text-[10px] text-muted-foreground">Showing {filtered.length} of {receipts.length} goods receipts</span>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2 mb-1">
              {selected && <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', GR_STATUS_CONFIG[selected.status]?.class)}>{GR_STATUS_CONFIG[selected.status]?.label}</span>}
              {selected && selected.lines.some(l => l.variance !== 0) && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning">Variance</span>
              )}
            </div>
            <SheetTitle className="text-base">{selected?.grNumber}</SheetTitle>
            <SheetDescription>PO: {selected?.poNumber} · {selected?.supplierName}</SheetDescription>
          </SheetHeader>

          {selected && (() => {
            const gr = selected;
            const isDraft = gr.status === 'draft';
            const isReceived = gr.status === 'received';
            const isPosted = gr.status === 'posted';
            const totalReceiving = gr.lines.reduce((s, l) => s + l.receivingNow, 0);
            const totalDamaged = gr.lines.reduce((s, l) => s + l.damagedQty, 0);
            const hasVariance = gr.lines.some(l => l.variance !== 0);
            const idx = sIdx(gr.status);

            return (
              <div className="p-6 space-y-6">
                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isDraft && (
                    <>
                      <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startReceive(gr)}><Truck className="h-3.5 w-3.5" /> Receive</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => openEdit(gr)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteConfirm(gr.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                    </>
                  )}
                  {isReceived && <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setPostConfirm(gr.id)}><Send className="h-3.5 w-3.5" /> Post</Button>}
                </div>

                {/* Status progression */}
                <div className="flex items-center gap-0">
                  {GR_STATUS_STEPS.map((step, i) => {
                    const reached = idx >= i;
                    return (
                      <div key={step} className="flex items-center flex-1">
                        <div className="flex items-center gap-2">
                          <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium',
                            reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          )}>
                            {reached ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                          </div>
                          <span className={cn('text-xs', reached ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                            {GR_STATUS_CONFIG[step]?.label}
                          </span>
                        </div>
                        {i < GR_STATUS_STEPS.length - 1 && <div className={cn('flex-1 h-px mx-3', reached && idx > i ? 'bg-primary' : 'bg-border')} />}
                      </div>
                    );
                  })}
                </div>

                {isPosted && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-muted-foreground">This goods receipt has been posted. Receiving data affects inventory balances.</p>
                  </div>
                )}

                {/* Summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-muted/20 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Receiving</p>
                    <p className="text-lg font-semibold text-foreground mt-1">{totalReceiving}</p>
                  </div>
                  <div className={cn('p-3 rounded-lg bg-muted/20 border', totalDamaged > 0 && 'border-warning/30')}>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Damaged</p>
                    <p className={cn('text-lg font-semibold mt-1', totalDamaged > 0 ? 'text-warning' : 'text-foreground')}>{totalDamaged}</p>
                  </div>
                  <div className={cn('p-3 rounded-lg bg-muted/20 border', hasVariance && 'border-destructive/30')}>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Variance</p>
                    <p className={cn('text-lg font-semibold mt-1', hasVariance ? 'text-destructive' : 'text-foreground')}>{gr.lines.filter(l => l.variance !== 0).length}</p>
                  </div>
                </div>

                {/* Lines */}
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Receiving Lines</span>
                  <div className="mt-2 rounded-lg border overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          {['Item', 'Unit', 'Ordered', 'Prev', 'Now', 'Dmg', 'Var', 'Notes'].map(h => (
                            <th key={h} className="text-[10px] font-medium text-muted-foreground px-3 py-2 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gr.lines.map(line => (
                          <tr key={line.id} className={cn('border-b last:border-0', line.variance !== 0 && 'bg-warning/[0.03]')}>
                            <td className="px-3 py-2 text-xs font-medium text-foreground">{line.itemName}</td>
                            <td className="px-3 py-2 text-[10px] text-muted-foreground">{line.unit}</td>
                            <td className="px-3 py-2 text-xs text-foreground">{line.orderedQty}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{line.previouslyReceived}</td>
                            <td className="px-3 py-2 text-xs font-medium text-foreground">{line.receivingNow}</td>
                            <td className="px-3 py-2">
                              {line.damagedQty > 0 ? <span className="text-xs font-medium text-warning">{line.damagedQty}</span> : <span className="text-[10px] text-muted-foreground">0</span>}
                            </td>
                            <td className="px-3 py-2">
                              {line.variance !== 0
                                ? <span className="text-xs font-semibold text-destructive flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />{line.variance}</span>
                                : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-[10px] text-muted-foreground max-w-[100px] truncate">{line.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {gr.notes && (
                  <div className="p-3.5 rounded-lg bg-muted/30 border">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                    <p className="text-xs text-foreground mt-1.5">{gr.notes}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={open => { if (!open) setFormOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Goods Receipt' : 'Create Goods Receipt'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update GR details and receiving lines.' : 'Select a PO to auto-populate receiving lines.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">GR Number</Label>
                <Input value={formData.grNumber} onChange={e => setFormData(prev => ({ ...prev, grNumber: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Linked PO</Label>
                <Select value={formData.poId} onValueChange={handlePoSelect}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select PO…" /></SelectTrigger>
                  <SelectContent>
                    {mockPurchaseOrders.map(po => (
                      <SelectItem key={po.id} value={po.id}>{po.poNumber} — {po.supplierName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Receipt Date</Label>
                <Input type="date" value={formData.receiptDate} onChange={e => setFormData(prev => ({ ...prev, receiptDate: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Received By</Label>
                <Input value={formData.receivedBy} onChange={e => setFormData(prev => ({ ...prev, receivedBy: e.target.value }))} placeholder="Name…" className="h-8 text-sm" />
              </div>
            </div>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Receiving Lines</span>
                <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={addFormLine}><Plus className="h-3 w-3" /> Add Line</Button>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      {['Item', 'Unit', 'Ordered', 'Receiving', 'Damaged', ''].map(h => (
                        <th key={h} className="text-[10px] font-medium text-muted-foreground px-3 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formData.lines.map((line, i) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="px-3 py-1.5"><Input value={line.itemName} onChange={e => updateFormLine(i, { itemName: e.target.value })} className="h-7 text-xs" placeholder="Item name" /></td>
                        <td className="px-3 py-1.5"><Input value={line.unit} onChange={e => updateFormLine(i, { unit: e.target.value })} className="h-7 text-xs w-16" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.orderedQty} onChange={e => updateFormLine(i, { orderedQty: +e.target.value })} className="h-7 text-xs w-20" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.receivingNow} onChange={e => updateFormLine(i, { receivingNow: +e.target.value })} className="h-7 text-xs w-20" /></td>
                        <td className="px-3 py-1.5"><Input type="number" value={line.damagedQty} onChange={e => updateFormLine(i, { damagedQty: +e.target.value })} className="h-7 text-xs w-20" /></td>
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
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <textarea value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!formData.grNumber.trim()} onClick={handleSave}>
              {editingId ? 'Update GR' : 'Create GR'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={receiveOpen} onOpenChange={open => { if (!open) setReceiveOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receive Goods — {receivingGR?.grNumber}</DialogTitle>
          </DialogHeader>
          {receivingGR && (
            <>
              <div className="grid grid-cols-3 gap-3 py-2">
                <div><p className="text-[10px] text-muted-foreground">PO</p><p className="text-sm font-medium text-primary">{receivingGR.poNumber}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Supplier</p><p className="text-sm font-medium text-foreground">{receivingGR.supplierName}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Receiver</p><p className="text-sm font-medium text-foreground">{receivingGR.receivedBy}</p></div>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      {['Item', 'Unit', 'Ordered', 'Receiving', 'Damaged', 'Notes'].map(h => (
                        <th key={h} className="text-[10px] font-medium text-muted-foreground px-3 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {receivingGR.lines.map((line, i) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="px-3 py-2 text-xs font-medium text-foreground">{line.itemName}</td>
                        <td className="px-3 py-2 text-[10px] text-muted-foreground">{line.unit}</td>
                        <td className="px-3 py-2 text-xs text-foreground">{line.orderedQty}</td>
                        <td className="px-3 py-2">
                          <Input type="number" defaultValue={line.receivingNow} className="h-7 text-xs w-20"
                            onChange={e => { const lines = [...receivingGR.lines]; lines[i] = { ...lines[i], receivingNow: +e.target.value, variance: +e.target.value - lines[i].orderedQty + lines[i].previouslyReceived }; setReceivingGR({ ...receivingGR, lines }); }} />
                        </td>
                        <td className="px-3 py-2">
                          <Input type="number" defaultValue={line.damagedQty} className="h-7 text-xs w-20"
                            onChange={e => { const lines = [...receivingGR.lines]; lines[i] = { ...lines[i], damagedQty: +e.target.value }; setReceivingGR({ ...receivingGR, lines }); }} />
                        </td>
                        <td className="px-3 py-2">
                          <Input defaultValue={line.notes || ''} placeholder="Notes…" className="h-7 text-xs w-32"
                            onChange={e => { const lines = [...receivingGR.lines]; lines[i] = { ...lines[i], notes: e.target.value }; setReceivingGR({ ...receivingGR, lines }); }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setReceiveOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleReceive}><CheckCircle2 className="h-3.5 w-3.5" /> Save Receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post Confirmation */}
      <Dialog open={!!postConfirm} onOpenChange={open => { if (!open) setPostConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Post Goods Receipt</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Posting will update inventory balances. This action is final.</p>
          {(() => {
            const gr = receipts.find(g => g.id === postConfirm);
            const hasVar = gr?.lines.some(l => l.variance !== 0);
            return hasVar ? (
              <div className="p-3 rounded-lg bg-warning/5 border border-warning/10">
                <p className="text-xs font-medium text-warning">Variance detected</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{gr!.lines.filter(l => l.variance !== 0).length} lines have receiving variance.</p>
              </div>
            ) : null;
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPostConfirm(null)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => postConfirm && handlePost(postConfirm)}>Post Receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">Delete Goods Receipt</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this goods receipt? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
