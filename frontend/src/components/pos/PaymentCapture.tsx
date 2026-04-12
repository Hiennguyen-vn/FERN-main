import { useState } from 'react';
import {
  ArrowLeft, CreditCard, Banknote, Smartphone, Building2, Ticket,
  Loader2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PaymentMethod, OrderLineItem } from '@/types/pos';
import { cn } from '@/lib/utils';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';

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
  currencyCode?: string;
  lineItems: OrderLineItem[];
  promoCode: string | null;
  promoDiscount: number;
  subtotal: number;
  taxAmount: number;
  onBack: () => void;
  onComplete: (paymentMethod: PaymentMethod) => Promise<{ ok: boolean; errorMessage?: string }>;
}

export function PaymentCapture({
  orderTotal,
  currencyCode,
  lineItems,
  promoCode,
  promoDiscount,
  subtotal,
  taxAmount,
  onBack,
  onComplete,
}: Props) {
  const [payment, setPayment] = useState<PaymentSplit>({ method: 'cash', amount: orderTotal });
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    setProcessing(true);
    setFailedMessage(null);
    try {
      const result = await onComplete(payment.method || 'cash');
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
          <p className="text-xs text-muted-foreground">
            Backend marks a customer order as paid with one payment method per capture.
          </p>

          <div className="surface-elevated p-4 space-y-3">
            <div>
              <span className="text-xs font-medium text-muted-foreground">Payment method</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {METHODS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setPayment({ method: key, amount: orderTotal })}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2.5 rounded-lg border text-[10px] font-medium transition-colors',
                    payment.method === key
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
                value={formatPosCurrency(payment.amount, currencyCode)}
                readOnly
                className="h-9 text-sm font-medium"
              />
            </div>
          </div>

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
                  <span className="text-foreground">{formatPosCurrency(item.lineTotal, currencyCode)}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-foreground">{formatPosCurrency(subtotal, currencyCode)}</span>
              </div>
              {promoCode && (
                <div className="flex justify-between text-xs text-success">
                  <span>Discount ({promoCode})</span>
                  <span>−{formatPosCurrency(promoDiscount, currencyCode)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tax</span>
                <span className="text-foreground">{formatPosCurrency(taxAmount, currencyCode)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
                <span>Total</span>
                <span>{formatPosCurrency(orderTotal, currencyCode)}</span>
              </div>
            </div>

            <div className="mt-3 rounded-md bg-info/5 border border-info/10 p-2.5 text-xs text-muted-foreground">
              Staff captures the full order amount in one step. Split payments are not available on the current backend contract.
            </div>

            {/* Confirm flow */}
            {!confirming ? (
              <Button
                className="w-full h-9 text-xs mt-3"
                onClick={() => setConfirming(true)}
              >
                Complete Payment
              </Button>
            ) : (
              <div className="mt-3 space-y-2">
              <div className="p-2.5 rounded-md bg-warning/8 border border-warning/15">
                  <p className="text-[11px] font-medium text-foreground">Confirm payment of {formatPosCurrency(orderTotal, currencyCode)}?</p>
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
