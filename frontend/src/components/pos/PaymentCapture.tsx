import { useState } from 'react';
import {
  ArrowLeft, CreditCard, Banknote, Smartphone, Building2, Ticket,
  Loader2, AlertTriangle, Plus, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PaymentMethod, OrderLineItem } from '@/types/pos';
import { cn } from '@/lib/utils';

const METHODS: { key: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'e-wallet', label: 'E-Wallet', icon: Smartphone },
  { key: 'bank-transfer', label: 'Bank Transfer', icon: Building2 },
  { key: 'voucher', label: 'Voucher', icon: Ticket },
];

interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
}

interface Props {
  orderTotal: number;
  lineItems: OrderLineItem[];
  promoCode: string | null;
  promoDiscount: number;
  subtotal: number;
  taxAmount: number;
  onBack: () => void;
  onComplete: (paymentMethod: PaymentMethod) => Promise<{ ok: boolean; errorMessage?: string }>;
}

export function PaymentCapture({ orderTotal, lineItems, promoCode, promoDiscount, subtotal, taxAmount, onBack, onComplete }: Props) {
  const [splits, setSplits] = useState<PaymentSplit[]>([{ method: 'cash', amount: orderTotal }]);
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const totalAllocated = splits.reduce((s, p) => s + p.amount, 0);
  const remaining = +(orderTotal - totalAllocated).toFixed(2);
  const isFullyAllocated = Math.abs(remaining) < 0.01;

  const addSplit = () => {
    setSplits([...splits, { method: 'card', amount: Math.max(remaining, 0) }]);
  };

  const removeSplit = (index: number) => {
    if (splits.length <= 1) return;
    setSplits(splits.filter((_, i) => i !== index));
  };

  const updateSplit = (index: number, updates: Partial<PaymentSplit>) => {
    setSplits(splits.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const handleConfirm = async () => {
    setProcessing(true);
    setFailedMessage(null);
    try {
      const result = await onComplete(splits[0]?.method || 'cash');
      if (!result.ok) {
        setFailedMessage(result.errorMessage || 'Unable to complete payment.');
        setConfirming(false);
      }
    } catch {
      setFailedMessage('Unable to complete payment.');
      setConfirming(false);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back to order
      </button>

      <div className="max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: Payment methods */}
        <div className="md:col-span-3 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Capture Payment</h2>

          {/* Splits */}
          <div className="space-y-3">
            {splits.map((split, i) => (
              <div key={i} className="surface-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Payment {i + 1}</span>
                  {splits.length > 1 && (
                    <button onClick={() => removeSplit(i)} className="text-destructive hover:text-destructive/80">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {METHODS.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => updateSplit(i, { method: key })}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2.5 rounded-lg border text-[10px] font-medium transition-colors',
                        split.method === key
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:bg-accent text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Amount</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={split.amount || ''}
                    onChange={(e) => updateSplit(i, { amount: parseFloat(e.target.value) || 0 })}
                    className="h-9 text-sm font-medium"
                  />
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={addSplit}>
            <Plus className="h-3 w-3" /> Add Split Payment
          </Button>

          {/* Payment failed banner */}
          {failedMessage && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-destructive/5 border border-destructive/15">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Payment failed</p>
                <p className="text-[10px] text-muted-foreground break-words">{failedMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Order summary */}
        <div className="md:col-span-2">
          <div className="surface-elevated p-4 sticky top-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Order Summary</h3>
            <div className="space-y-1.5 mb-3">
              {lineItems.map(item => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.quantity}× {item.productName}</span>
                  <span className="text-foreground">${item.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-foreground">${subtotal.toFixed(2)}</span>
              </div>
              {promoCode && (
                <div className="flex justify-between text-xs text-success">
                  <span>Discount ({promoCode})</span>
                  <span>−${promoDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tax</span>
                <span className="text-foreground">${taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
                <span>Total</span>
                <span>${orderTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Allocation status */}
            <div className={cn(
              'mt-3 p-2.5 rounded-md text-xs font-medium',
              isFullyAllocated ? 'bg-success/10 text-success' :
              remaining > 0 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
            )}>
              {isFullyAllocated ? 'Fully allocated' : remaining > 0 ? `$${remaining.toFixed(2)} remaining` : `$${Math.abs(remaining).toFixed(2)} over-allocated`}
            </div>

            {/* Confirm flow */}
            {!confirming ? (
              <Button
                className="w-full h-9 text-xs mt-3"
                disabled={!isFullyAllocated}
                onClick={() => setConfirming(true)}
              >
                Complete Payment
              </Button>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="p-2.5 rounded-md bg-warning/8 border border-warning/15">
                  <p className="text-[11px] font-medium text-foreground">Confirm payment of ${orderTotal.toFixed(2)}?</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">This action cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setConfirming(false)}>Cancel</Button>
                  <Button size="sm" className="flex-1 h-8 text-xs" disabled={processing} onClick={() => void handleConfirm()}>
                    {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
