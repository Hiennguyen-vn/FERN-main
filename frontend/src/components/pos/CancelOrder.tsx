import { useState } from 'react';
import {
  ArrowLeft, AlertTriangle, Loader2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SaleOrder } from '@/types/pos';

interface Props {
  order: SaleOrder;
  onBack: () => void;
  onConfirm: (reason: string) => void;
}

export function CancelOrder({ order, onBack, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onConfirm(reason);
    }, 600);
  };

  if (order.status !== 'open') {
    return (
      <div className="p-6 animate-fade-in">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <div className="max-w-md mx-auto surface-elevated p-6 text-center">
          <XCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Cannot cancel this order</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only open orders can be cancelled. Completed orders are immutable in V1.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <div className="max-w-md mx-auto surface-elevated p-6 space-y-5">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Cancel Order {order.orderNumber}</h2>
          <p className="text-sm text-muted-foreground mt-1">This action cannot be reversed</p>
        </div>

        {/* Order summary */}
        <div className="p-3 rounded-lg bg-muted/40 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Items</span>
            <span className="text-foreground">{order.lineItems.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total</span>
            <span className="text-foreground font-medium">${order.total.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason" className="text-sm font-medium text-foreground">
            Cancellation reason <span className="text-destructive">*</span>
          </Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Customer changed mind"
            className="h-9"
          />
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-warning/8 border border-warning/15">
          <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Cancelling an order marks it as void. The order record will be preserved in audit history but cannot be reopened.
          </p>
        </div>

        {!confirming ? (
          <Button
            variant="destructive"
            className="w-full h-9 text-xs"
            disabled={!reason.trim()}
            onClick={() => setConfirming(true)}
          >
            Cancel Order
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="p-2.5 rounded-md bg-destructive/8 border border-destructive/15 text-center">
              <p className="text-xs font-medium text-foreground">Are you sure? This cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setConfirming(false)}>Go Back</Button>
              <Button variant="destructive" size="sm" className="flex-1 h-8 text-xs" disabled={loading} onClick={handleConfirm}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Yes, Cancel'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
