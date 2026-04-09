import {
  ArrowLeft, Tag, CreditCard, ShoppingBag, CheckCircle2, XCircle,
  Clock, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SaleOrder } from '@/types/pos';
import { PAYMENT_METHOD_LABELS } from '@/constants/pos';
import { cn } from '@/lib/utils';

interface Props {
  order: SaleOrder;
  onBack: () => void;
  onPay: () => void;
  onCancel: () => void;
}

export function SaleOrderDetail({ order, onBack, onPay, onCancel }: Props) {
  const statusIcon = order.status === 'completed' ? CheckCircle2 : order.status === 'cancelled' ? XCircle : Clock;
  const StatusIcon = statusIcon;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      {/* Header */}
      <div className="surface-elevated p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{order.orderNumber}</h2>
              <span className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full',
                order.status === 'completed' ? 'bg-success/10 text-success' :
                order.status === 'open' ? 'bg-info/10 text-info' :
                'bg-destructive/10 text-destructive'
              )}>{order.status}</span>
              <span className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-full',
                order.paymentStatus === 'paid' ? 'bg-success/10 text-success' :
                'bg-muted text-muted-foreground'
              )}>{order.paymentStatus}</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <span>{order.outletName}</span>
              <span>·</span>
              <span>Session {order.sessionCode}</span>
              <span>·</span>
              <span>{order.createdBy}</span>
              <span>·</span>
              <span>{new Date(order.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {order.status === 'open' && order.paymentStatus === 'unpaid' && (
              <>
                <Button variant="outline" size="sm" className="h-8 text-xs text-destructive border-destructive/20 hover:bg-destructive/5" onClick={onCancel}>
                  Cancel Order
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={onPay}>
                  Capture Payment
                </Button>
              </>
            )}
            {order.status === 'completed' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted/50">
                <Info className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Completed orders are immutable in V1</span>
              </div>
            )}
          </div>
        </div>

        {/* Promotion display */}
        {order.promotionCode && (
          <div className="mt-4 flex items-center gap-2 p-2.5 rounded-lg bg-success/5 border border-success/15">
            <Tag className="h-3.5 w-3.5 text-success" />
            <span className="text-xs font-medium text-success">{order.promotionCode}</span>
            <span className="text-xs text-success">— ${order.promotionDiscount?.toFixed(2)} discount applied</span>
          </div>
        )}

        {/* Table info */}
        {order.tableNumber && (
          <div className="mt-2 text-xs text-muted-foreground">Table: {order.tableNumber}</div>
        )}

        {/* Cancel reason */}
        {order.cancelReason && (
          <div className="mt-4 flex items-start gap-2.5 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
            <XCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">Cancellation Reason</p>
              <p className="text-xs text-muted-foreground mt-0.5">{order.cancelReason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="surface-elevated">
        <div className="px-5 py-3 border-b">
          <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Product', 'Category', 'Qty', 'Unit Price', 'Line Total'].map(h => (
                  <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-5 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.lineItems.map(item => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{item.productName}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{item.category}</td>
                  <td className="px-5 py-3 text-sm text-foreground">{item.quantity}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">${item.unitPrice.toFixed(2)}</td>
                  <td className="px-5 py-3 text-sm font-medium text-foreground">${item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t bg-muted/20 space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Subtotal</span><span>${order.subtotal.toFixed(2)}</span>
          </div>
          {order.promotionCode && (
            <div className="flex justify-between text-xs text-success">
              <span>Promotion ({order.promotionCode})</span>
              <span>−${order.promotionDiscount?.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Tax</span><span>${order.taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t">
            <span>Total</span><span>${order.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Payments */}
      {order.payments.length > 0 && (
        <div className="surface-elevated p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Payments</h3>
          <div className="space-y-2">
            {order.payments.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-foreground capitalize">{p.method.replace('-', ' ')}</p>
                    {p.reference && <p className="text-[10px] text-muted-foreground">{p.reference}</p>}
                  </div>
                </div>
                <p className="text-sm font-semibold text-foreground">${p.amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
