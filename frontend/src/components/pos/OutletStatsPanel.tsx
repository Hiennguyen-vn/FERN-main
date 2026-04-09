import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ShoppingBag, DollarSign, BarChart3, TrendingUp,
  Activity, Loader2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { salesApi, type OutletHourlyRevenueView } from '@/api/fern-api';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { normalizeNumericId } from '@/constants/pos';
import type { OutletTodayStats } from '@/types/pos';

interface Props {
  onBack: () => void;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function OutletStatsPanel({ onBack }: Props) {
  const { token, scope } = useShellRuntime();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OutletTodayStats | null>(null);
  const [failed, setFailed] = useState(false);

  const outletId = normalizeNumericId(scope.outletId);

  useEffect(() => {
    const load = async () => {
      if (!token || !outletId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const live = await salesApi.outletStats(token, outletId);
        const mapped: OutletTodayStats = {
          outletId: String(live.outletId ?? outletId),
          businessDate: String(live.businessDate ?? new Date().toISOString().slice(0, 10)),
          ordersToday: Number(live.ordersToday ?? 0),
          completedSales: Number(live.completedSales ?? 0),
          cancelledOrders: Number(live.cancelledOrders ?? 0),
          revenueToday: toNumber(live.revenueToday),
          averageOrderValue: toNumber(live.averageOrderValue),
          activeSessionCode: live.activeSessionCode ? String(live.activeSessionCode) : undefined,
          activeSessionStatus: live.activeSessionStatus ? String(live.activeSessionStatus) as OutletTodayStats['activeSessionStatus'] : undefined,
          topCategory: String(live.topCategory ?? 'N/A'),
          peakHour: String(live.peakHour ?? '—'),
          hourlyRevenue: Array.isArray(live.hourlyRevenue)
            ? live.hourlyRevenue.map((entry: OutletHourlyRevenueView) => ({
                hour: String(entry.hour),
                revenue: toNumber(entry.revenue),
              }))
            : [],
        };
        setStats(mapped);
        setFailed(false);
      } catch (error) {
        console.error('Failed to fetch outlet stats:', error);
        setFailed(true);
        setStats(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [outletId, token]);

  const maxHourly = useMemo(() => {
    if (!stats || stats.hourlyRevenue.length === 0) return 0;
    return Math.max(...stats.hourlyRevenue.map((entry) => entry.revenue));
  }, [stats]);

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Outlet Statistics" />;
  }

  if (!outletId) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <EmptyState
          title="Outlet scope is required"
          description="Select a numeric outlet scope to load outlet statistics from backend APIs."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Outlet Today</h2>
            <p className="text-xs text-muted-foreground">
              {stats?.businessDate || '—'} — {scope.outletName || `Outlet ${outletId}`}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!loading && failed ? (
        <div className="surface-elevated p-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Unable to load outlet statistics</p>
          <p className="text-xs text-muted-foreground mt-1">The backend did not return a valid outlet stats response.</p>
        </div>
      ) : null}

      {!loading && !failed && stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {[
              { label: 'Orders Today', value: stats.ordersToday, icon: ShoppingBag, color: 'text-primary' },
              { label: 'Completed', value: stats.completedSales, icon: Activity, color: 'text-success' },
              { label: 'Revenue', value: `$${stats.revenueToday.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-foreground' },
              { label: 'Avg Order', value: `$${stats.averageOrderValue.toFixed(2)}`, icon: BarChart3, color: 'text-foreground' },
              { label: 'Cancelled', value: stats.cancelledOrders, icon: XCircle, color: 'text-destructive' },
            ].map((kpi) => (
              <div key={kpi.label} className="surface-elevated p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
                </div>
                <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <div className="surface-elevated p-4">
              <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Active Session
              </h4>
              {stats.activeSessionCode ? (
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{stats.activeSessionCode}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{stats.activeSessionStatus || 'open'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No active session</p>
              )}
            </div>
            <div className="surface-elevated p-4">
              <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Today's Peak
              </h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{stats.peakHour}</p>
                  <p className="text-[10px] text-muted-foreground">Peak revenue hour</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{stats.topCategory}</p>
                  <p className="text-[10px] text-muted-foreground">Top category</p>
                </div>
              </div>
            </div>
          </div>

          <div className="surface-elevated p-4">
            <h4 className="text-xs font-semibold text-foreground mb-4">Hourly Revenue</h4>
            {stats.hourlyRevenue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hourly revenue points available.</p>
            ) : (
              <div className="flex items-end gap-1.5 h-[120px]">
                {stats.hourlyRevenue.map((hour) => {
                  const pct = maxHourly > 0 ? (hour.revenue / maxHourly) * 100 : 0;
                  return (
                    <div key={hour.hour} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full rounded-t bg-primary/20 hover:bg-primary/40 transition-colors relative group" style={{ height: `${Math.max(pct, 4)}%` }}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          ${hour.revenue.toFixed(2)}
                        </div>
                      </div>
                      <span className="text-[8px] text-muted-foreground">{hour.hour.slice(0, 2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
