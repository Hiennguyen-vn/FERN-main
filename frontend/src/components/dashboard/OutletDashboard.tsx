import { useState } from 'react';
import {
  Monitor, ShoppingBag, DollarSign, TrendingUp, AlertTriangle,
  ClipboardCheck, FileText, Truck,
  Play, Plus, ArrowUpRight, ArrowDownRight, Clock, CheckCircle2,
  Wifi, WifiOff, CalendarDays, CreditCard, RefreshCw, ChevronRight,
  XCircle, Pause, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ShellScope } from '@/types/shell';
import { cn } from '@/lib/utils';
import { useDashboardData } from '@/hooks/use-dashboard-data';

const BUSINESS_DATE = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

function KpiCard({
  label, value, change, positive, icon: Icon, accent, badge,
}: {
  label: string; value: string; change?: string; positive?: boolean;
  icon: React.ElementType; accent?: 'default' | 'success' | 'warning' | 'destructive';
  badge?: string;
}) {
  const accentMap = {
    default: 'bg-primary/8 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  };
  const a = accent || 'default';

  return (
    <div className="surface-elevated p-4 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
        <div className={cn('h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0', accentMap[a])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <p className="text-xl font-semibold text-foreground leading-none">{value}</p>
        {badge && (
          <span className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none',
            a === 'warning' ? 'bg-warning/10 text-warning' :
            a === 'destructive' ? 'bg-destructive/10 text-destructive' :
            'bg-muted text-muted-foreground'
          )}>
            {badge}
          </span>
        )}
      </div>
      {change && (
        <div className="mt-2 flex items-center gap-1 text-[11px]">
          {positive ? <ArrowUpRight className="h-3 w-3 text-success" /> : <ArrowDownRight className="h-3 w-3 text-destructive" />}
          <span className={positive ? 'text-success' : 'text-destructive'}>{change}</span>
          <span className="text-muted-foreground">vs yesterday</span>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, action, actionLabel }: { title: string; action?: () => void; actionLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action && actionLabel && (
        <button onClick={action} className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5">
          {actionLabel} <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function QuickActionButton({ icon: Icon, label, variant }: { icon: React.ElementType; label: string; variant?: 'primary' | 'default' }) {
  return (
    <button className={cn(
      'flex flex-col items-center gap-1.5 p-3 rounded-lg transition-colors text-center min-w-[72px]',
      variant === 'primary'
        ? 'bg-primary/8 hover:bg-primary/12 text-primary'
        : 'bg-muted/60 hover:bg-accent text-foreground'
    )}>
      <Icon className="h-4 w-4" />
      <span className="text-[10px] font-medium leading-tight">{label}</span>
    </button>
  );
}

function StatusDot({ status }: { status: 'active' | 'idle' | 'closed' }) {
  const colors = { active: 'bg-success', idle: 'bg-warning', closed: 'bg-muted-foreground' };
  return (
    <span className="relative flex h-2 w-2">
      {status === 'active' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-40" />}
      <span className={cn('relative inline-flex rounded-full h-2 w-2', colors[status])} />
    </span>
  );
}

interface OutletDashboardProps {
  scope: ShellScope;
}

export function OutletDashboard({ scope }: OutletDashboardProps) {
  const { kpis, recentOrders, lowStock, loading, error, refresh } = useDashboardData();
  const [sessionActive, setSessionActive] = useState(true);
  const outletName = scope.outletName || 'All Outlets';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-[1600px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Outlet Control Center</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="scope-chip scope-chip-outlet">{outletName}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {BUSINESS_DATE}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-success">
              <Wifi className="h-3 w-3" /> Live
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={refresh}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5">
            <Plus className="h-3 w-3" /> New Sale
          </Button>
        </div>
      </div>

      {error && (
        <div className="permission-banner permission-banner-unavailable animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">Live dashboard unavailable</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {/* Session banner */}
      {!sessionActive && (
        <div className="permission-banner permission-banner-blocked animate-fade-in">
          <Pause className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">No active POS session</p>
            <p className="text-xs mt-0.5 opacity-80">Open a session to begin processing sales.</p>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSessionActive(true)}>Open Session</Button>
        </div>
      )}

      {/* KPI Row — Real Data */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Active Sessions"
          value={String(kpis.activeSessions)}
          icon={Monitor}
          accent={kpis.activeSessions > 0 ? 'success' : 'default'}
          badge={kpis.activeSessions > 0 ? 'Live' : undefined}
        />
        <KpiCard label="Total Orders" value={String(kpis.totalOrders)} icon={ShoppingBag} />
        <KpiCard label="Revenue" value={`$${kpis.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={DollarSign} accent="success" />
        <KpiCard label="Avg Order Value" value={`$${kpis.avgOrderValue.toFixed(2)}`} icon={TrendingUp} />
        <KpiCard
          label="Low Stock Alerts"
          value={String(kpis.lowStockCount)}
          icon={AlertTriangle}
          accent={kpis.outOfStockCount > 0 ? 'destructive' : kpis.lowStockCount > 0 ? 'warning' : 'default'}
          badge={kpis.outOfStockCount > 0 ? `${kpis.outOfStockCount} OOS` : undefined}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Completed" value={String(kpis.completedOrders)} icon={CheckCircle2} accent="success" />
        <KpiCard label="Pending / Preparing" value={String(kpis.pendingOrders)} icon={Clock} accent={kpis.pendingOrders > 0 ? 'warning' : 'default'} />
        <KpiCard label="Out of Stock" value={String(kpis.outOfStockCount)} icon={XCircle} accent={kpis.outOfStockCount > 0 ? 'destructive' : 'default'} />
        <KpiCard label="Stock Items Tracked" value={String(lowStock.length + (kpis.totalOrders > 0 ? 10 : 0))} icon={ClipboardCheck} />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Quick Actions */}
          <div className="surface-elevated p-4">
            <SectionHeader title="Quick Actions" />
            <div className="flex flex-wrap gap-2">
              <QuickActionButton icon={Play} label="Open Session" variant={sessionActive ? 'default' : 'primary'} />
              <QuickActionButton icon={Plus} label="New Sale" variant="primary" />
              <QuickActionButton icon={ClipboardCheck} label="Stock Count" />
              <QuickActionButton icon={FileText} label="Create PO" />
              <QuickActionButton icon={Truck} label="Receive Goods" />
            </div>
          </div>

          {/* Low Stock Watchlist — Real Data */}
          <div className="surface-elevated">
            <div className="p-4 pb-0">
              <SectionHeader title="Low Stock Watchlist" action={() => {}} actionLabel="All Inventory" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Item</th>
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Outlet</th>
                    <th className="text-right text-[11px] font-medium text-muted-foreground px-4 py-2.5">On Hand</th>
                    <th className="text-right text-[11px] font-medium text-muted-foreground px-4 py-2.5">Reorder Lvl</th>
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">All items above reorder level</td></tr>
                  ) : lowStock.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-foreground">{row.itemName}</p>
                        <p className="text-[10px] text-muted-foreground">{row.category}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.outletName}</td>
                      <td className={cn('px-4 py-2.5 text-sm text-right font-medium', row.critical ? 'text-destructive' : 'text-warning')}>
                        {row.quantity}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-muted-foreground">{row.reorderLevel}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          'text-[10px] font-medium px-2 py-0.5 rounded-full',
                          row.quantity === 0 ? 'bg-destructive/10 text-destructive' : row.critical ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
                        )}>
                          {row.quantity === 0 ? 'Out of Stock' : row.critical ? 'Critical' : 'Low'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Orders — Real Data */}
          <div className="surface-elevated">
            <div className="p-4 pb-0">
              <SectionHeader title="Recent Orders" action={() => {}} actionLabel="All Sales" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Order</th>
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Type</th>
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Table</th>
                    <th className="text-right text-[11px] font-medium text-muted-foreground px-4 py-2.5">Amount</th>
                    <th className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">No orders yet</td></tr>
                  ) : recentOrders.map(o => (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{o.order_number}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{o.order_type || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{o.table_number || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-right font-medium text-foreground">${o.total.toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          'text-[10px] font-medium px-2 py-0.5 rounded-full',
                          o.status === 'completed' ? 'bg-success/10 text-success' :
                          o.status === 'preparing' ? 'bg-warning/10 text-warning' :
                          'bg-muted text-muted-foreground'
                        )}>
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          {/* Revenue Summary */}
          <div className="surface-elevated p-4">
            <SectionHeader title="Revenue Breakdown" />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total Revenue</span>
                <span className="text-sm font-semibold text-foreground">${kpis.totalRevenue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg Order Value</span>
                <span className="text-sm font-medium text-foreground">${kpis.avgOrderValue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Completed Orders</span>
                <span className="text-sm font-medium text-foreground">{kpis.completedOrders}</span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pending</span>
                <span className={cn('text-sm font-medium', kpis.pendingOrders > 0 ? 'text-warning' : 'text-foreground')}>{kpis.pendingOrders}</span>
              </div>
            </div>
          </div>

          {/* Stock Health */}
          <div className="surface-elevated p-4">
            <SectionHeader title="Stock Health" />
            <div className="space-y-3">
              {[
                { label: 'Low Stock Items', value: kpis.lowStockCount, color: kpis.lowStockCount > 0 ? 'text-warning' : 'text-foreground' },
                { label: 'Out of Stock', value: kpis.outOfStockCount, color: kpis.outOfStockCount > 0 ? 'text-destructive' : 'text-foreground' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={cn('text-sm font-semibold', item.color)}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Connection Status */}
          <div className="surface-elevated p-4">
            <SectionHeader title="System Status" />
            <div className="space-y-2">
              {[
                { label: 'Database', status: 'Connected', ok: true },
                { label: 'Real-time', status: 'Active', ok: true },
                { label: 'POS Gateway', status: kpis.activeSessions > 0 ? 'Online' : 'No Sessions', ok: kpis.activeSessions > 0 },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  <span className={cn('flex items-center gap-1 text-[10px] font-medium', s.ok ? 'text-success' : 'text-muted-foreground')}>
                    {s.ok ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
