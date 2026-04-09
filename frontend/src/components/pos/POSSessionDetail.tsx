import { useState } from 'react';
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, ShoppingBag, CreditCard,
  DollarSign, BarChart3, ScrollText, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { POSSession, POSSessionStatus, SaleOrder } from '@/types/pos';
import { PAYMENT_METHOD_LABELS } from '@/constants/pos';
import { cn } from '@/lib/utils';

const STATUS_STEPS: { key: POSSessionStatus; label: string }[] = [
  { key: 'open', label: 'Opened' },
  { key: 'closed', label: 'Closed' },
  { key: 'reconciled', label: 'Reconciled' },
];

interface Props {
  session: POSSession;
  orders: SaleOrder[];
  onBack: () => void;
  onClose: () => void;
  onReconcile: () => void;
  onNewOrder: () => void;
  onViewOrder: (orderId: string) => void;
}

export function POSSessionDetail({ session, orders, onBack, onClose, onReconcile, onNewOrder, onViewOrder }: Props) {
  const [activeTab, setActiveTab] = useState<'orders' | 'payments' | 'reconciliation' | 'activity'>('orders');
  const sessionOrders = orders;

  const statusIndex = STATUS_STEPS.findIndex(s => s.key === session.status);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </button>

      {/* Session header */}
      <div className="surface-elevated p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{session.code}</h2>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">{session.outletName}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{session.businessDate}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-foreground font-medium">{session.openedBy}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.status === 'open' && (
              <>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close Session</Button>
                <Button size="sm" className="h-8 text-xs" onClick={onNewOrder}>New Order</Button>
              </>
            )}
            {session.status === 'closed' && (
              <Button size="sm" className="h-8 text-xs" onClick={onReconcile}>Reconcile</Button>
            )}
          </div>
        </div>

        {/* Status progression */}
        <div className="mt-5 flex items-center gap-0">
          {STATUS_STEPS.map((step, i) => {
            const reached = i <= statusIndex;
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium',
                    reached ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {reached ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={cn('text-xs', reached ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {step.label}
                  </span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={cn('flex-1 h-px mx-3', reached && i < statusIndex ? 'bg-primary' : 'bg-border')} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Orders</span>
          </div>
          <p className="text-xl font-semibold text-foreground">{session.orderCount}</p>
        </div>
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Revenue</span>
          </div>
          <p className="text-xl font-semibold text-foreground">${session.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Avg Order</span>
          </div>
          <p className="text-xl font-semibold text-foreground">
            ${session.orderCount > 0 ? (session.totalRevenue / session.orderCount).toFixed(2) : '0.00'}
          </p>
        </div>
        <div className="surface-elevated p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Pay Methods</span>
          </div>
          <p className="text-xl font-semibold text-foreground">{session.paymentSummary.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex items-center gap-0">
        {[
          { key: 'orders', label: 'Orders', icon: ShoppingBag },
          { key: 'payments', label: 'Payments', icon: CreditCard },
          { key: 'reconciliation', label: 'Reconciliation', icon: BarChart3 },
          { key: 'activity', label: 'Activity', icon: ScrollText },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'orders' && (
        <div className="surface-elevated">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30">
                  {['Order #', 'Time', 'Created By', 'Items', 'Total', 'Payment', 'Status'].map((h) => (
                    <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessionOrders.map((order) => (
                  <tr key={order.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-medium text-primary cursor-pointer hover:underline" onClick={() => onViewOrder(order.id)}>
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground">{order.createdBy}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{order.lineItems.length}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-foreground">${order.total.toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-full',
                        order.paymentStatus === 'paid' ? 'bg-success/10 text-success' :
                        order.paymentStatus === 'partial' ? 'bg-warning/10 text-warning' :
                        'bg-muted text-muted-foreground'
                      )}>{order.paymentStatus}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-full',
                        order.status === 'completed' ? 'bg-success/10 text-success' :
                        order.status === 'open' ? 'bg-info/10 text-info' :
                        'bg-destructive/10 text-destructive'
                      )}>{order.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="surface-elevated p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Payment Summary by Method</h3>
          <div className="space-y-3">
            {session.paymentSummary.map((ps) => (
              <div key={ps.method} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{PAYMENT_METHOD_LABELS[ps.method] || ps.method}</p>
                    <p className="text-[11px] text-muted-foreground">{ps.count} transactions</p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-foreground">${ps.total.toLocaleString()}</p>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3 border-t">
              <p className="text-sm font-semibold text-foreground">Total</p>
              <p className="text-lg font-semibold text-foreground">${session.totalRevenue.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="surface-elevated p-5 text-center py-12">
          {session.status === 'reconciled' ? (
            <div>
              <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">Session Reconciled</p>
              <p className="text-xs text-muted-foreground mt-1">
                Reconciled at {session.reconciledAt ? new Date(session.reconciledAt).toLocaleString() : '—'}
              </p>
            </div>
          ) : session.status === 'closed' ? (
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Session closed and ready for reconciliation</p>
              <Button size="sm" onClick={onReconcile}>Start Reconciliation</Button>
            </div>
          ) : (
            <div>
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Close the session first to begin reconciliation</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="surface-elevated p-5">
          <div className="space-y-3">
            {[
              { action: 'Session opened', actor: session.openedBy, time: session.openedAt },
              ...(session.closedAt ? [{ action: 'Session closed', actor: session.openedBy, time: session.closedAt }] : []),
              ...(session.reconciledAt ? [{ action: 'Session reconciled', actor: session.openedBy, time: session.reconciledAt }] : []),
            ].reverse().map((ev, i) => (
              <div key={i} className="flex items-start gap-3 p-2.5 rounded-md bg-muted/20">
                <ScrollText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">{ev.action}</p>
                  <p className="text-[10px] text-muted-foreground">{ev.actor} · {new Date(ev.time).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
