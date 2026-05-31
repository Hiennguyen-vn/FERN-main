import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Loader2, Clock,
  DollarSign, ShoppingBag, Printer, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PaymentMethod, POSSession } from '@/types/pos';
import { PAYMENT_METHOD_LABELS } from '@/constants/pos';
import { cn } from '@/lib/utils';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';

const CLOSE_COUNT_METHODS: PaymentMethod[] = ['cash', 'card', 'e-wallet', 'bank-transfer', 'voucher'];

interface CloseCountRow {
  method: PaymentMethod;
  expected: number;
  actual: number;
}

function buildCloseCountRows(session: POSSession): CloseCountRow[] {
  const expectedByMethod = new Map(session.paymentSummary.map((ps) => [ps.method, ps.total]));
  return CLOSE_COUNT_METHODS.map((method) => {
    const expected = expectedByMethod.get(method) ?? 0;
    return { method, expected, actual: expected };
  });
}

interface Props {
  session: POSSession;
  onBack: () => void;
  onConfirm: (payload: {
    lines: Array<{ paymentMethod: string; actualAmount: number }>;
    note?: string;
  }) => Promise<void> | void;
}

export function CloseSession({ session, onBack, onConfirm }: Props) {
  const expectedSnapshot = useMemo(
    () => session.paymentSummary.map((ps) => `${ps.method}:${ps.total}`).sort().join('|'),
    [session.paymentSummary],
  );
  const [rows, setRows] = useState(() => buildCloseCountRows(session));
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(buildCloseCountRows(session));
  }, [expectedSnapshot, session.id]);

  const updateActual = (index: number, value: number) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, actual: value } : row));
  };

  const totalExpected = rows.reduce((sum, row) => sum + row.expected, 0);
  const totalActual = rows.reduce((sum, row) => sum + row.actual, 0);
  const discrepancy = +(totalActual - totalExpected).toFixed(2);
  const hasDiscrepancy = Math.abs(discrepancy) >= 0.01;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm({
        lines: rows.map((row) => ({
          paymentMethod: row.method,
          actualAmount: row.actual,
        })),
        note: note.trim() || undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 print:hidden">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <div className="max-w-lg mx-auto surface-elevated p-6 space-y-5 pos-print-area">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-warning/10 flex items-center justify-center mb-3 print:hidden">
            <Clock className="h-6 w-6 text-warning" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Z-Report — Close Session</h2>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{session.code}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{session.outletName ?? '—'} · {new Date().toLocaleString('vi-VN')}</p>
        </div>

        <div className="flex justify-end print:hidden">
          <Button variant="outline" size="sm" aria-label="Print Z-report" className="h-7 text-xs gap-1" onClick={() => window.print()}>
            <Printer className="h-3 w-3" /> In Z-report
          </Button>
        </div>

        {/* Session summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/40 text-center">
            <ShoppingBag className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-xl font-semibold text-foreground">{session.orderCount}</p>
            <p className="text-[10px] text-muted-foreground">Total Orders</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/40 text-center">
            <DollarSign className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-xl font-semibold text-foreground">{formatPosCurrency(session.totalRevenue, session.currencyCode)}</p>
            <p className="text-[10px] text-muted-foreground">Revenue (Billed)</p>
          </div>
        </div>

        {/* Payment breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Payment Breakdown</p>
          {session.paymentSummary.map(ps => (
            <div key={ps.method} className="flex items-center justify-between p-2.5 rounded-md bg-muted/20">
              <span className="text-xs text-foreground">{PAYMENT_METHOD_LABELS[ps.method] || ps.method}</span>
              <span className="text-xs font-medium text-foreground">{formatPosCurrency(ps.total, session.currencyCode)} ({ps.count})</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs font-semibold text-foreground">Collected</span>
            <span className="text-xs font-semibold text-foreground">{formatPosCurrency(session.totalCollected, session.currencyCode)}</span>
          </div>
          {session.outstandingAmount > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-md bg-warning/10 border border-warning/30">
              <span className="text-xs font-semibold text-warning">Outstanding</span>
              <span className="text-xs font-semibold text-warning">{formatPosCurrency(session.outstandingAmount, session.currencyCode)}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 print:hidden">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Actual Count</p>
            <span className={cn(
              'text-xs font-semibold',
              !hasDiscrepancy ? 'text-muted-foreground' : discrepancy > 0 ? 'text-success' : 'text-destructive',
            )}>
              {discrepancy > 0 ? '+' : ''}{formatPosCurrency(discrepancy, session.currencyCode)}
            </span>
          </div>
          <div className="rounded-lg border bg-background overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">Method</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">Expected</th>
                  <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">Counted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.method} className="border-b last:border-0">
                    <td className="px-3 py-2 text-xs font-medium text-foreground">
                      {PAYMENT_METHOD_LABELS[row.method] || row.method}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {formatPosCurrency(row.expected, session.currencyCode)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.actual}
                        onChange={(event) => {
                          const next = Number.parseFloat(event.target.value);
                          updateActual(index, Number.isFinite(next) && next >= 0 ? next : 0);
                        }}
                        className="ml-auto h-8 w-[120px] text-right text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20">
                  <td className="px-3 py-2 text-xs font-semibold text-foreground">Total</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                    {formatPosCurrency(totalExpected, session.currencyCode)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">
                    {formatPosCurrency(totalActual, session.currencyCode)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="space-y-2 print:hidden">
          <Label htmlFor="close-note" className="text-sm font-medium text-foreground">Closing Note (optional)</Label>
          <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Count note or discrepancy reason" className="h-9" />
        </div>

        {note && <div className="hidden print:block text-[11px] border-t pt-2"><strong>Note:</strong> {note}</div>}

        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-info/5 border border-info/10 print:hidden">
          <BarChart3 className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Confirming closes the session and records the count as the final reconciliation.
          </p>
        </div>

        {!confirming ? (
          <Button className="w-full h-10 print:hidden" onClick={() => setConfirming(true)}>Close & Reconcile</Button>
        ) : (
          <div className="space-y-2 print:hidden">
            <div className="p-2.5 rounded-md bg-warning/8 border border-warning/15 text-center">
              <p className="text-xs font-medium text-foreground">Confirm final count?</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">No new orders can be created after this session is reconciled.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button className="flex-1 h-9 text-xs" disabled={loading} onClick={handleConfirm}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm Count'}
              </Button>
            </div>
          </div>
        )}

        <div className="hidden print:block border-t border-dashed pt-3 text-center text-[10px] text-muted-foreground">
          ─── End of Z-Report ───<br/>
          Generated {new Date().toISOString()}
        </div>
      </div>
    </div>
  );
}
