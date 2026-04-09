import { useState } from 'react';
import {
  ArrowLeft, Plus, Trash2, AlertTriangle, CheckCircle2, Clock,
  XCircle, Send, Save, Ban, Eye, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WasteStatus, WasteRecord } from '@/types/inventory';
import { mockWasteRecords, mockStockBalances } from '@/data/mock-inventory';

const STATUS_CONFIG: Record<WasteStatus, { label: string; class: string }> = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  posted: { label: 'Posted', class: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/10 text-destructive' },
};

type WView = { screen: 'list' } | { screen: 'create' };

export function WasteRecordModule() {
  const [view, setView] = useState<WView>({ screen: 'list' });

  if (view.screen === 'create') {
    return <WasteForm onBack={() => setView({ screen: 'list' })} onSave={() => setView({ screen: 'list' })} />;
  }

  const totalWasteToday = mockWasteRecords
    .filter(w => w.status === 'posted')
    .reduce((s, w) => s + w.quantity, 0);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Waste Records</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Track and document waste for traceability and loss analysis</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setView({ screen: 'create' })}>
          <Plus className="h-3.5 w-3.5" /> Record Waste
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Records Today</span>
          </div>
          <p className="text-xl font-semibold text-foreground">{mockWasteRecords.length}</p>
        </div>
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total Waste Qty</span>
          </div>
          <p className="text-xl font-semibold text-destructive">{totalWasteToday.toFixed(1)}</p>
        </div>
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Pending</span>
          </div>
          <p className="text-xl font-semibold text-warning">{mockWasteRecords.filter(w => w.status === 'draft').length}</p>
        </div>
      </div>

      {/* Records table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Code', 'Ingredient', 'Qty', 'UoM', 'Reason', 'Recorded By', 'Time', 'Status', 'Impact'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockWasteRecords.map(w => {
              const cfg = STATUS_CONFIG[w.status];
              return (
                <tr key={w.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{w.code}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{w.ingredientName}</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-destructive">{w.quantity}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{w.uom}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground max-w-[200px] truncate">{w.reason}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{w.recordedBy}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(w.recordedAt).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{w.stockImpact !== undefined ? `${w.stockImpact}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Waste Form ── */
function WasteForm({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  const selectedIngredient = mockStockBalances.find(b => b.ingredientId === ingredientId);
  const qtyNum = parseFloat(quantity) || 0;
  const wouldGoNegative = selectedIngredient && qtyNum > selectedIngredient.currentQty;

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-lg">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Record Waste</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Document waste with reason for traceability</p>
      </div>

      <div className="surface-elevated p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Ingredient *</label>
          <select
            value={ingredientId}
            onChange={e => setIngredientId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select ingredient…</option>
            {mockStockBalances.map(b => (
              <option key={b.ingredientId} value={b.ingredientId}>{b.ingredientName} ({b.currentQty} {b.uom} in stock)</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Quantity *</label>
          <Input value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="0" step="0.1" placeholder="0.0" className="h-9" />
          {selectedIngredient && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Current stock: {selectedIngredient.currentQty} {selectedIngredient.uom}
            </p>
          )}
        </div>

        {wouldGoNegative && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[11px] font-medium text-destructive">Negative stock prevention</p>
              <p className="text-[10px] text-muted-foreground">
                Waste quantity ({qtyNum}) exceeds current stock ({selectedIngredient?.currentQty} {selectedIngredient?.uom}).
                Posting will result in an out-of-stock condition.
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Reason *</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {['Spoilage', 'Expired', 'Preparation waste', 'Spillage', 'Temperature failure', 'Other'].map(r => (
              <button key={r} onClick={() => setReason(r)}
                className={cn('text-[11px] px-2.5 py-1.5 rounded-md border transition-colors',
                  reason === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
                )}>{r}</button>
            ))}
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Detailed reason…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><Save className="h-3 w-3" /> Save Draft</Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onSave}
          disabled={!ingredientId || !quantity || !reason.trim()}>
          <Send className="h-3.5 w-3.5" /> Post
        </Button>
      </div>
    </div>
  );
}
