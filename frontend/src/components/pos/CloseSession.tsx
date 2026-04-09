import { useState } from 'react';
import {
  ArrowLeft, AlertTriangle, Loader2, CheckCircle2, Clock,
  DollarSign, ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { POSSession } from '@/types/pos';
import { PAYMENT_METHOD_LABELS } from '@/constants/pos';

interface Props {
  session: POSSession;
  onBack: () => void;
  onConfirm: () => void;
}

export function CloseSession({ session, onBack, onConfirm }: Props) {
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onConfirm();
    }, 600);
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <div className="max-w-lg mx-auto surface-elevated p-6 space-y-5">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-warning/10 flex items-center justify-center mb-3">
            <Clock className="h-6 w-6 text-warning" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Close Session</h2>
          <p className="text-sm text-muted-foreground mt-1">{session.code}</p>
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
            <p className="text-xl font-semibold text-foreground">${session.totalRevenue.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Total Revenue</p>
          </div>
        </div>

        {/* Payment breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Payment Breakdown</p>
          {session.paymentSummary.map(ps => (
            <div key={ps.method} className="flex items-center justify-between p-2.5 rounded-md bg-muted/20">
              <span className="text-xs text-foreground">{PAYMENT_METHOD_LABELS[ps.method] || ps.method}</span>
              <span className="text-xs font-medium text-foreground">${ps.total.toLocaleString()} ({ps.count})</span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="close-note" className="text-sm font-medium text-foreground">Closing Note (optional)</Label>
          <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., End of evening shift" className="h-9" />
        </div>

        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-info/5 border border-info/10">
          <AlertTriangle className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Closing the session prevents new orders. You can still reconcile the session after closing.
          </p>
        </div>

        {!confirming ? (
          <Button className="w-full h-10" onClick={() => setConfirming(true)}>Close Session</Button>
        ) : (
          <div className="space-y-2">
            <div className="p-2.5 rounded-md bg-warning/8 border border-warning/15 text-center">
              <p className="text-xs font-medium text-foreground">Confirm session close?</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">No new orders can be created after closing.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button className="flex-1 h-9 text-xs" disabled={loading} onClick={handleConfirm}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm Close'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
