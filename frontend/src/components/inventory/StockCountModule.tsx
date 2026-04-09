import { useState } from 'react';
import {
  ArrowLeft, Plus, ClipboardCheck, Clock, CheckCircle2, XCircle,
  AlertTriangle, Save, Send, Ban, Eye, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { StockCountStatus, StockCountSession, StockCountLine } from '@/types/inventory';
import { mockStockCounts, mockCountLines } from '@/data/mock-inventory';

const STATUS_CONFIG: Record<StockCountStatus, { label: string; class: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground', icon: Clock },
  counting: { label: 'Counting', class: 'bg-info/10 text-info', icon: ClipboardCheck },
  posted: { label: 'Posted', class: 'bg-success/10 text-success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/10 text-destructive', icon: XCircle },
};

type SCView =
  | { screen: 'list' }
  | { screen: 'detail'; countId: string }
  | { screen: 'start' };

interface Props {
  onBack?: () => void;
}

export function StockCountModule({ onBack }: Props) {
  const [view, setView] = useState<SCView>({ screen: 'list' });

  if (view.screen === 'start') {
    return <StartStockCount onBack={() => setView({ screen: 'list' })} onCreated={(id) => setView({ screen: 'detail', countId: id })} />;
  }
  if (view.screen === 'detail') {
    return <StockCountDetail countId={view.countId} onBack={() => setView({ screen: 'list' })} />;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Stock Counts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Physical inventory verification sessions</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setView({ screen: 'start' })}>
          <Plus className="h-3.5 w-3.5" /> Start Count
        </Button>
      </div>

      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Code', 'Outlet', 'Created By', 'Status', 'Started', 'Posted', 'Items', 'Counted', 'Variance'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockStockCounts.map(sc => {
              const cfg = STATUS_CONFIG[sc.status];
              return (
                <tr key={sc.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => setView({ screen: 'detail', countId: sc.id })}>
                  <td className="px-4 py-2.5 text-sm font-medium text-primary">{sc.code}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{sc.outletName}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{sc.createdBy}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(sc.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{sc.postedAt ? new Date(sc.postedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{sc.totalItems}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground">{sc.countedItems}/{sc.totalItems}</td>
                  <td className="px-4 py-2.5">
                    {sc.varianceItems > 0 ? (
                      <span className="text-xs font-medium text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {sc.varianceItems} items (${Math.abs(sc.varianceValue).toFixed(2)})
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Start Stock Count ── */
function StartStockCount({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const [note, setNote] = useState('');

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-lg">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Start Stock Count</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Create a new physical count session — system snapshots will be taken at creation time</p>
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
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Items to Count</p>
            <p className="text-sm font-medium text-foreground">12 ingredients</p>
          </div>
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Snapshot Time</p>
            <p className="text-sm font-medium text-foreground">Now</p>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Notes (optional)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g., Morning opening count, pre-close count…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-none"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => onCreated('sc-02')}>
          <ClipboardCheck className="h-3.5 w-3.5" /> Start Counting
        </Button>
      </div>
    </div>
  );
}

/* ── Stock Count Detail ── */
function StockCountDetail({ countId, onBack }: { countId: string; onBack: () => void }) {
  const session = mockStockCounts.find(s => s.id === countId);
  const lines = mockCountLines.filter(l => l.countSessionId === countId);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  if (!session) return <div className="p-6 text-sm text-muted-foreground">Count session not found</div>;

  const cfg = STATUS_CONFIG[session.status];
  const isEditable = session.status === 'counting' || session.status === 'draft';
  const isPosted = session.status === 'posted';

  const totalVariance = lines.reduce((s, l) => s + (l.actualQty !== null ? l.variance : 0), 0);
  const varianceLines = lines.filter(l => l.actualQty !== null && l.variance !== 0);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back to counts
      </button>

      {/* Header */}
      <div className="surface-elevated p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{session.code}</h2>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">{session.outletName}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-foreground font-medium">{session.createdBy}</span>
              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', cfg.class)}>{cfg.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditable && (
              <>
                <Button variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setShowCancelConfirm(true)}>
                  <Ban className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowPostConfirm(true)}
                  disabled={lines.some(l => l.actualQty === null)}>
                  <Send className="h-3.5 w-3.5" /> Post Count
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total Items</p>
            <p className="text-lg font-semibold text-foreground">{session.totalItems}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Counted</p>
            <p className="text-lg font-semibold text-foreground">{lines.filter(l => l.actualQty !== null).length}/{session.totalItems}</p>
          </div>
          <div className={cn('p-3 rounded-lg', varianceLines.length > 0 ? 'bg-warning/5 border border-warning/10' : 'bg-muted/30')}>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Variance Items</p>
            <p className={cn('text-lg font-semibold', varianceLines.length > 0 ? 'text-warning' : 'text-foreground')}>{varianceLines.length}</p>
          </div>
          <div className={cn('p-3 rounded-lg', totalVariance !== 0 ? 'bg-warning/5 border border-warning/10' : 'bg-muted/30')}>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total Variance</p>
            <p className={cn('text-lg font-semibold', totalVariance < 0 ? 'text-destructive' : totalVariance > 0 ? 'text-success' : 'text-foreground')}>
              {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {isPosted && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border">
          <Eye className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">This count has been posted. Count data and resulting ledger entries are immutable.</p>
        </div>
      )}

      {session.status === 'cancelled' && session.cancelReason && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10">
          <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-medium text-destructive">Cancelled</p>
            <p className="text-[11px] text-muted-foreground">{session.cancelReason}</p>
          </div>
        </div>
      )}

      {/* Count lines table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Ingredient', 'Category', 'UoM', 'System Qty', 'Actual Qty', 'Variance'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const hasVariance = line.actualQty !== null && line.variance !== 0;
              const notCounted = line.actualQty === null;
              return (
                <tr key={line.id} className={cn('border-b last:border-0 transition-colors',
                  hasVariance ? 'bg-warning/[0.03]' : notCounted ? 'bg-muted/10' : 'hover:bg-muted/20'
                )}>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{line.ingredientName}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.category}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{line.uom}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{line.systemQty}</td>
                  <td className="px-4 py-2.5">
                    {isEditable && notCounted ? (
                      <Input type="number" placeholder="—" className="h-7 w-20 text-xs" />
                    ) : (
                      <span className={cn('text-sm', notCounted ? 'text-muted-foreground italic' : 'font-medium text-foreground')}>
                        {line.actualQty !== null ? line.actualQty : 'Pending'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {line.actualQty !== null ? (
                      <span className={cn('text-sm font-semibold flex items-center gap-1',
                        line.variance < 0 ? 'text-destructive' : line.variance > 0 ? 'text-success' : 'text-muted-foreground'
                      )}>
                        {hasVariance && <AlertTriangle className="h-3 w-3" />}
                        {line.variance > 0 ? '+' : ''}{line.variance}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Post confirmation */}
      {showPostConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm" onClick={() => setShowPostConfirm(false)}>
          <div className="surface-elevated p-6 max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">Post Stock Count</h3>
            <p className="text-xs text-muted-foreground">This will create ledger entries for all variances. Posted counts are immutable.</p>
            {varianceLines.length > 0 && (
              <div className="p-3 rounded-lg bg-warning/5 border border-warning/10">
                <p className="text-xs font-medium text-warning">{varianceLines.length} variance items detected</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Total variance: {totalVariance > 0 ? '+' : ''}{totalVariance.toFixed(2)}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowPostConfirm(false)}>Cancel</Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => { setShowPostConfirm(false); onBack(); }}>Confirm Post</Button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm" onClick={() => setShowCancelConfirm(false)}>
          <div className="surface-elevated p-6 max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground text-destructive">Cancel Stock Count</h3>
            <p className="text-xs text-muted-foreground">This will permanently cancel this count session. No ledger entries will be created.</p>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Reason *</label>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason for cancellation…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowCancelConfirm(false)}>Keep Counting</Button>
              <Button variant="destructive" size="sm" className="h-8 text-xs" disabled={!cancelReason.trim()} onClick={() => { setShowCancelConfirm(false); onBack(); }}>Cancel Count</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
