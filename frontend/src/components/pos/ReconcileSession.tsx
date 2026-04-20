import { useState } from 'react';
import {
  ArrowLeft, Loader2, AlertTriangle, BarChart3, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PaymentMethod, POSSession } from '@/types/pos';
import { PAYMENT_METHOD_LABELS } from '@/constants/pos';
import { cn } from '@/lib/utils';

interface Props {
  session: POSSession;
  onBack: () => void;
  onConfirm: (payload: {
    lines: Array<{ paymentMethod: string; actualAmount: number }>;
    note?: string;
  }) => Promise<void> | void;
  available?: boolean;
  unavailableReason?: string;
}

interface ReconRow {
  method: PaymentMethod;
  expected: number;
  actual: number;
}

export function ReconcileSession({
  session,
  onBack,
  onConfirm,
  available = true,
  unavailableReason = 'Session reconciliation write endpoint is not exposed by the current backend APIs.',
}: Props) {
  const initialRows: ReconRow[] = session.paymentSummary.map((ps) => ({
    method: ps.method,
    expected: ps.total,
    actual: ps.total,
  }));

  const [rows, setRows] = useState(initialRows);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const updateActual = (index: number, value: number) => {
    setRows(rows.map((r, i) => i === index ? { ...r, actual: value } : r));
  };

  const totalExpected = rows.reduce((s, r) => s + r.expected, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const discrepancy = +(totalActual - totalExpected).toFixed(2);
  const hasDiscrepancy = Math.abs(discrepancy) >= 0.01;

  const handleConfirm = async () => {
    if (!available) return;
    setLoading(true);
    try {
      await onConfirm({
        lines: rows.map((row) => ({
          paymentMethod: row.method,
          actualAmount: row.actual,
        })),
        note: notes.trim() || undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <div className="max-w-2xl mx-auto space-y-5">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Reconcile Session</h2>
          <p className="text-sm text-muted-foreground mt-1">{session.code} · {session.businessDate}</p>
        </div>

        {/* Info notice */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-info/5 border border-info/10">
          <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Reconciliation records the actual amounts collected. It does not modify completed sale history.
          </p>
        </div>

        {session.outstandingAmount > 0 && (
          <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-warning/10 border border-warning/30">
            <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">
                Outstanding revenue: ${session.outstandingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Billed ${session.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} but only ${session.totalCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} collected via payments. Reconcile only records collected amounts — resolve unpaid orders before closing.
              </p>
            </div>
          </div>
        )}

        {!available && (
          <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-warning/8 border border-warning/15">
            <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">Reconciliation API unavailable</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{unavailableReason}</p>
            </div>
          </div>
        )}

        {/* Reconciliation table */}
        <div className="surface-elevated">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left text-[11px] font-medium text-muted-foreground px-5 py-2.5">Payment Method</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground px-5 py-2.5">Expected</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground px-5 py-2.5 w-[150px]">Actual</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground px-5 py-2.5">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const diff = +(row.actual - row.expected).toFixed(2);
                  const hasDiff = Math.abs(diff) >= 0.01;
                  return (
                    <tr key={row.method} className="border-b last:border-0">
                      <td className="px-5 py-3 text-sm font-medium text-foreground capitalize">
                        {PAYMENT_METHOD_LABELS[row.method] || row.method}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground text-right">${row.expected.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          value={row.actual}
                          onChange={(e) => updateActual(i, parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-right w-[130px] ml-auto"
                        />
                      </td>
                      <td className={cn(
                        'px-5 py-3 text-sm text-right font-medium',
                        !hasDiff ? 'text-muted-foreground' : diff > 0 ? 'text-success' : 'text-destructive'
                      )}>
                        {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20">
                  <td className="px-5 py-3 text-sm font-semibold text-foreground">Total</td>
                  <td className="px-5 py-3 text-sm font-semibold text-foreground text-right">${totalExpected.toFixed(2)}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-foreground text-right">${totalActual.toFixed(2)}</td>
                  <td className={cn(
                    'px-5 py-3 text-sm font-semibold text-right',
                    !hasDiscrepancy ? 'text-muted-foreground' : discrepancy > 0 ? 'text-success' : 'text-destructive'
                  )}>
                    {discrepancy > 0 ? '+' : ''}{discrepancy.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Discrepancy warning */}
        {hasDiscrepancy && (
          <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-warning/8 border border-warning/15">
            <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">Discrepancy detected: ${Math.abs(discrepancy).toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {discrepancy < 0 ? 'Actual collection is less than expected.' : 'Actual collection exceeds expected.'} Add a note for audit purposes.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="recon-notes" className="text-sm font-medium text-foreground">Reconciliation Notes</Label>
          <Input
            id="recon-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes about this reconciliation…"
            className="h-9"
          />
        </div>

        <Button className="w-full h-10" disabled={loading || !available} onClick={() => void handleConfirm()}>
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : available ? 'Confirm Reconciliation' : 'Reconciliation API Unavailable'}
        </Button>
      </div>
    </div>
  );
}
