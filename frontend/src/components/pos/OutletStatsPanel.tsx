import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayLocalISO } from '@/lib/date-format';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  DollarSign,
  Loader2,
  RefreshCcw,
  ShoppingBag,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { salesApi, type OutletHourlyRevenueView } from '@/api/fern-api';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { normalizeNumericId } from '@/constants/pos';
import type { OutletTodayStats } from '@/types/pos';
import { formatPosCurrency } from '@/components/pos/sale-order-utils';

interface Props {
  onBack: () => void;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseHour(value: string) {
  const match = String(value || '').match(/^(\d{1,2})/);
  if (!match) return 0;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
}

function normalizeHourlyRevenue(entries: OutletTodayStats['hourlyRevenue']) {
  const byHour = new Map<number, number>();
  for (const entry of entries) {
    byHour.set(parseHour(entry.hour), toNumber(entry.revenue));
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    revenue: byHour.get(hour) ?? 0,
  }));
}

function formatHourRange(hour: string) {
  const start = parseHour(hour);
  const end = (start + 1) % 24;
  return `${String(start).padStart(2, '0')}:00-${String(end).padStart(2, '0')}:00`;
}

function formatCategoryLabel(value: string) {
  const text = String(value || '').trim();
  if (!text || text.toUpperCase() === 'N/A') return 'No sales yet';
  return text
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortSessionCode(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  const posSuffix = text.match(/POS-[A-Z0-9-]+$/i)?.[0];
  if (posSuffix) return posSuffix;
  if (text.length <= 34) return text;
  return `${text.slice(0, 14)}...${text.slice(-12)}`;
}

export function OutletStatsPanel({ onBack }: Props) {
  const { token, scope } = useShellRuntime();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OutletTodayStats | null>(null);
  const [failed, setFailed] = useState(false);

  const outletId = normalizeNumericId(scope.outletId);

  const loadStats = useCallback(async () => {
    if (!token || !outletId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const live = await salesApi.outletStats(token, outletId);
      const mapped: OutletTodayStats = {
        outletId: String(live.outletId ?? outletId),
        businessDate: String(live.businessDate ?? todayLocalISO()),
        currencyCode: String(live.currencyCode || 'VND').toUpperCase(),
        ordersToday: Number(live.ordersToday ?? 0),
        completedSales: Number(live.completedSales ?? 0),
        cancelledOrders: Number(live.cancelledOrders ?? 0),
        revenueToday: toNumber(live.revenueToday),
        averageOrderValue: toNumber(live.averageOrderValue),
        activeSessionCode: live.activeSessionCode ? String(live.activeSessionCode) : undefined,
        activeSessionStatus: live.activeSessionStatus
          ? String(live.activeSessionStatus) as OutletTodayStats['activeSessionStatus']
          : undefined,
        topCategory: String(live.topCategory ?? 'N/A'),
        peakHour: String(live.peakHour ?? '--'),
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
  }, [outletId, token]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const hourlyRevenue = useMemo(
    () => normalizeHourlyRevenue(stats?.hourlyRevenue ?? []),
    [stats?.hourlyRevenue],
  );

  const maxHourly = useMemo(
    () => Math.max(0, ...hourlyRevenue.map((entry) => entry.revenue)),
    [hourlyRevenue],
  );

  const peakPoint = useMemo(() => {
    if (hourlyRevenue.length === 0) return { hour: stats?.peakHour || '00:00', revenue: 0 };
    return hourlyRevenue.reduce((best, entry) => entry.revenue > best.revenue ? entry : best, hourlyRevenue[0]);
  }, [hourlyRevenue, stats?.peakHour]);

  const totalHourlyRevenue = useMemo(
    () => hourlyRevenue.reduce((sum, entry) => sum + entry.revenue, 0),
    [hourlyRevenue],
  );

  const hasHourlyRevenue = maxHourly > 0;
  const currencyCode = stats?.currencyCode || 'VND';
  const yAxisLabels = [maxHourly, maxHourly / 2, 0];

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Outlet Statistics" />;
  }

  if (!outletId) {
    return (
      <div className="p-6">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to POS sessions"
        >
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
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to POS sessions"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Outlet Today</h2>
            <p className="text-xs text-muted-foreground">
              {stats?.businessDate || '--'} - {scope.outletName || `Outlet ${outletId}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadStats()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60 sm:self-auto"
        >
          <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
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
          <button
            type="button"
            onClick={() => void loadStats()}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !failed && stats ? (
        <>
          <div className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Orders Today', value: stats.ordersToday, icon: ShoppingBag, color: 'text-primary' },
              { label: 'Completed', value: stats.completedSales, icon: Activity, color: 'text-success' },
              { label: 'Revenue', value: formatPosCurrency(stats.revenueToday, currencyCode), icon: DollarSign, color: 'text-foreground' },
              { label: 'Avg Order', value: formatPosCurrency(stats.averageOrderValue, currencyCode), icon: BarChart3, color: 'text-foreground' },
              { label: 'Cancelled', value: stats.cancelledOrders, icon: XCircle, color: 'text-destructive' },
            ].map((kpi) => (
              <div key={kpi.label} className="surface-elevated p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
                </div>
                <p className={cn('text-lg font-semibold tabular-nums sm:text-xl', kpi.color)}>{kpi.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 mb-5 lg:grid-cols-2">
            <div className="surface-elevated p-4">
              <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Active Session
              </h4>
              {stats.activeSessionCode ? (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground font-mono break-all" title={stats.activeSessionCode}>
                      {shortSessionCode(stats.activeSessionCode)}
                    </p>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground tabular-nums">{formatHourRange(peakPoint.hour)}</p>
                  <p className="text-[10px] text-muted-foreground">Peak revenue hour</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground tabular-nums">{formatPosCurrency(peakPoint.revenue, currencyCode)}</p>
                  <p className="text-[10px] text-muted-foreground">Peak revenue</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm font-semibold text-foreground">{formatCategoryLabel(stats.topCategory)}</p>
                  <p className="text-[10px] text-muted-foreground">Top category</p>
                </div>
              </div>
            </div>
          </div>

          <div className="surface-elevated p-4">
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-xs font-semibold text-foreground">Hourly Revenue</h4>
                <p className="text-[10px] text-muted-foreground">
                  Local outlet time, {formatPosCurrency(totalHourlyRevenue, currencyCode)} total in completed sales.
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-[10px] text-muted-foreground">Peak</p>
                <p className="text-xs font-semibold text-foreground tabular-nums">{formatHourRange(peakPoint.hour)}</p>
              </div>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[560px] grid-cols-[64px_minmax(0,1fr)] gap-3">
                <div className="h-[180px] flex flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums">
                  {yAxisLabels.map((label, index) => (
                    <span key={`${label}-${index}`}>{formatPosCurrency(label, currencyCode)}</span>
                  ))}
                </div>
                <div>
                  <div className="relative h-[180px] border-l border-b border-border/80">
                    {[0, 1, 2].map((line) => (
                      <div
                        key={line}
                        className="absolute left-0 right-0 border-t border-dashed border-border/70"
                        style={{ top: `${line * 50}%` }}
                      />
                    ))}
                    <div className="absolute inset-0 flex items-end gap-1 px-2">
                      {hourlyRevenue.map((hour) => {
                        const pct = maxHourly > 0 ? (hour.revenue / maxHourly) * 100 : 0;
                        const isPeak = hasHourlyRevenue && hour.hour === peakPoint.hour;
                        const height = hour.revenue > 0 ? Math.max(pct, 8) : 1;
                        return (
                          <div key={hour.hour} className="flex-1 h-full flex items-end">
                            <div
                              className={cn(
                                'w-full rounded-t-sm transition-colors',
                                hour.revenue > 0
                                  ? isPeak ? 'bg-primary' : 'bg-primary/65 hover:bg-primary/90'
                                  : 'bg-muted/60',
                              )}
                              style={{ height: `${height}%` }}
                              title={`${formatHourRange(hour.hour)}: ${formatPosCurrency(hour.revenue, currencyCode)}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                    {hourlyRevenue.map((hour) => {
                      const hourNumber = parseHour(hour.hour);
                      return (
                        <span
                          key={hour.hour}
                          className={cn(
                            'text-center text-[9px] tabular-nums',
                            hour.hour === peakPoint.hour ? 'font-semibold text-primary' : 'text-muted-foreground',
                          )}
                        >
                          {hourNumber % 2 === 0 || hour.hour === peakPoint.hour ? hour.hour.slice(0, 2) : ''}
                        </span>
                      );
                    })}
                  </div>
                  {!hasHourlyRevenue ? (
                    <p className="mt-3 text-xs text-muted-foreground">No completed revenue has been recorded for this outlet today.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
