import { useState } from 'react';
import {
  ArrowLeft, Plus, Send, Ban, Eye, Trash2, ArrowUpRight, ArrowDownRight,
  CheckCircle2, Clock, XCircle, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { StockAdjustment as SAType, AdjustmentStatus } from '@/types/inventory';
import { mockAdjustments } from '@/data/mock-inventory';

const STATUS_CONFIG: Record<AdjustmentStatus, { label: string; class: string }> = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  posted: { label: 'Posted', class: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/10 text-destructive' },
};

type AdjView = { screen: 'list' } | { screen: 'detail'; adjId: string } | { screen: 'create' };

export function StockAdjustmentModule() {
  const [view, setView] = useState<AdjView>({ screen: 'list' });

  if (view.screen === 'create') {
    return <AdjustmentForm onBack={() => setView({ screen: 'list' })} onSave={() => setView({ screen: 'list' })} />;
  }
  if (view.screen === 'detail') {
    return <AdjustmentDetail adjId={view.adjId} onBack={() => setView({ screen: 'list' })} />;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Stock Adjustments</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Correct inventory balances with documented adjustments</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setView({ screen: 'create' })}>
          <Plus className="h-3.5 w-3.5" /> New Adjustment
        </Button>
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Code', 'Outlet', 'Created By', 'Date', 'Status', 'Lines', 'Notes'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockAdjustments.map(adj => {
              const cfg = STATUS_CONFIG[adj.status];
              return (
                <tr key={adj.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => setView({ screen: 'detail', adjId: adj.id })}>
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{adj.code}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{adj.outletName}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{adj.createdBy}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(adj.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-2.5"><span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span></td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{adj.lines.length}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[200px]">{adj.notes || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Adjustment Detail ── */
function AdjustmentDetail({ adjId, onBack }: { adjId: string; onBack: () => void }) {
  const adj = mockAdjustments.find(a => a.id === adjId);
  if (!adj) return <div className="p-6 text-sm text-muted-foreground">Adjustment not found</div>;

  const cfg = STATUS_CONFIG[adj.status];
  const isPosted = adj.status === 'posted';

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back to adjustments
      </button>

      <div className="surface-elevated p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{adj.code}</h2>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">{adj.outletName}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-foreground font-medium">{adj.createdBy}</span>
              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span>
            </div>
          </div>
          {adj.status === 'draft' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/30"><Ban className="h-3 w-3 mr-1" />Cancel</Button>
              <Button size="sm" className="h-8 text-xs gap-1.5"><Send className="h-3.5 w-3.5" /> Post</Button>
            </div>
          )}
        </div>
      </div>

      {isPosted && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border">
          <Eye className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">This adjustment has been posted. Lines and resulting ledger entries are immutable.</p>
        </div>
      )}

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Ingredient', 'UoM', 'Direction', 'Quantity', 'Reason', 'Note'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {adj.lines.map(line => (
              <tr key={line.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-sm font-medium text-foreground">{line.ingredientName}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.uom}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 w-fit',
                    line.direction === 'increase' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  )}>
                    {line.direction === 'increase' ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {line.direction}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm font-semibold text-foreground">{line.quantity}</td>
                <td className="px-4 py-2.5 text-xs text-foreground">{line.reason}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Create Adjustment ── */
function AdjustmentForm({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [notes, setNotes] = useState('');

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-2xl">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div>
        <h2 className="text-lg font-semibold text-foreground">New Stock Adjustment</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Add lines, provide reasons, then post to update ledger</p>
      </div>

      <div className="surface-elevated p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Outlet</p>
            <p className="text-sm font-medium text-foreground">Downtown Flagship</p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Operator</p>
            <p className="text-sm font-medium text-foreground">Marcus Rivera</p>
          </div>
        </div>

        {/* Placeholder line entry */}
        <div className="border rounded-lg p-4 border-dashed flex flex-col items-center justify-center py-8 text-center">
          <Plus className="h-6 w-6 text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground">Add adjustment lines</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Select ingredients, set direction and quantity, provide reasons</p>
          <Button variant="outline" size="sm" className="h-7 text-[10px] mt-3">
            <Plus className="h-3 w-3 mr-1" /> Add Line
          </Button>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Adjustment notes…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><Save className="h-3 w-3" /> Save Draft</Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onSave}><Send className="h-3.5 w-3.5" /> Post</Button>
      </div>
    </div>
  );
}
