import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Layers,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Store,
  Wifi,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  inventoryApi,
  orgApi,
  productApi,
  salesApi,
  type DailyRevenueRow,
  type PosSessionView,
  type ScopeOutlet,
  type StockBalanceView,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { cn } from '@/lib/utils';
import { formatMoney, formatPct } from '@/components/finance/finance-utils';
import { formatPeriodLabel } from '@/components/finance/finance-phase2-utils';
import {
  buildRegionalOpsSnapshot,
  type RegionalOpsSnapshot,
} from '@/components/reports/regional-ops-utils';

interface PeriodOption {
  key: string;
  label: string;
}

function normalizeNumericId(value: string | undefined | null) {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

function monthRange(periodKey: string) {
  const [year, month] = periodKey.split('-').map(Number);
  if (!year || !month) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function currentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

function buildPeriodOptions(rows: DailyRevenueRow[] | Array<{ month?: string | null }>) {
  const keys = Array.from(
    new Set(
      rows
        .map((row) => String('month' in row ? row.month ?? '' : '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.localeCompare(left));
  return keys.map((key) => ({ key, label: formatPeriodLabel(key) })) satisfies PeriodOption[];
}

async function fetchLowBalances(token: string, outletId: string) {
  const response = await inventoryApi.balancesPage(token, {
    outletId,
    lowOnly: true,
    limit: 200,
    offset: 0,
    sortBy: 'qtyOnHand',
    sortDir: 'asc',
  });
  return response.items || [];
}

function getScopeLabel(scope: ReturnType<typeof useShellRuntime>['scope'], outlets: ScopeOutlet[]) {
  if (scope.outletId) {
    return outlets.find((outlet) => outlet.id === scope.outletId)?.name || scope.outletName || 'Selected outlet';
  }
  if (scope.regionId) {
    return scope.regionName || 'Selected region';
  }
  return 'All regions';
}

function emptySnapshot(): RegionalOpsSnapshot {
  return {
    currency: 'VND',
    netSales: 0,
    grossSales: 0,
    discounts: 0,
    orderCount: 0,
    avgOrderValue: 0,
    activeSessions: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    outletsInScope: 0,
    outletsWithSales: 0,
    dataCoveragePct: 0,
    outletRows: [],
  };
}

export function RevenueDashboard() {
  const { token, scope } = useShellRuntime();
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const [periodOptions, setPeriodOptions] = useState<PeriodOption[]>([]);
  const [visibleOutlets, setVisibleOutlets] = useState<ScopeOutlet[]>([]);
  const [snapshot, setSnapshot] = useState<RegionalOpsSnapshot>(() => emptySnapshot());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [partialError, setPartialError] = useState('');

  const scopedOutletId = normalizeNumericId(scope.outletId);
  const scopedRegionId = normalizeNumericId(scope.regionId);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    setPartialError('');

    try {
      const [outletsResult, monthlyResult, sessionsResult] = await Promise.allSettled([
        orgApi.outlets(token, scopedRegionId || undefined),
        salesApi.monthlyRevenue(token, { outletId: scopedOutletId || undefined }),
        salesApi.posSessions(token, {
          outletId: scopedOutletId || undefined,
          status: 'open',
          limit: 500,
          offset: 0,
          sortBy: 'openedAt',
          sortDir: 'desc',
        }),
      ]);

      if (outletsResult.status === 'rejected') {
        throw outletsResult.reason;
      }

      const outletRows = scopedOutletId
        ? outletsResult.value.filter((outlet) => outlet.id === scopedOutletId)
        : outletsResult.value;
      const outletIds = new Set(outletRows.map((outlet) => outlet.id));
      setVisibleOutlets(outletRows);

      const monthlyRows = monthlyResult.status === 'fulfilled'
        ? monthlyResult.value.filter((row) => outletIds.size === 0 || outletIds.has(String(row.outletId)))
        : [];
      const options = buildPeriodOptions(monthlyRows);
      setPeriodOptions(options);

      const nextPeriodKey = selectedPeriodKey && options.some((option) => option.key === selectedPeriodKey)
        ? selectedPeriodKey
        : options[0]?.key || currentPeriodKey();
      if (nextPeriodKey !== selectedPeriodKey) {
        setSelectedPeriodKey(nextPeriodKey);
      }

      const range = monthRange(nextPeriodKey);
      const [dailyResult, itemsResult, lowStockResult] = await Promise.allSettled([
        salesApi.dailyRevenue(token, {
          outletId: scopedOutletId || undefined,
          startDate: range?.startDate,
          endDate: range?.endDate,
        }),
        productApi.items(token),
        Promise.all(
          outletRows.map(async (outlet) => [outlet.id, await fetchLowBalances(token, outlet.id)] as const),
        ),
      ]);

      const failedSources: string[] = [];
      if (monthlyResult.status === 'rejected') failedSources.push('monthly revenue');
      if (sessionsResult.status === 'rejected') failedSources.push('POS sessions');
      if (dailyResult.status === 'rejected') failedSources.push('daily revenue');
      if (itemsResult.status === 'rejected') failedSources.push('item catalog');
      if (lowStockResult.status === 'rejected') failedSources.push('inventory alerts');

      const itemMap = new Map(
        (itemsResult.status === 'fulfilled' && Array.isArray(itemsResult.value) ? itemsResult.value : [])
          .map((item) => [String(item.id), item] as const),
      );
      const lowBalancesByOutlet = new Map<string, StockBalanceView[]>();
      if (lowStockResult.status === 'fulfilled') {
        for (const [outletId, balances] of lowStockResult.value) {
          lowBalancesByOutlet.set(
            outletId,
            balances.filter((balance) => {
              const item = itemMap.get(String(balance.itemId ?? ''));
              const minStockLevel = Number(item?.minStockLevel ?? Number.NaN);
              if (!Number.isFinite(minStockLevel)) return true;
              return Number(balance.qtyOnHand ?? 0) <= minStockLevel;
            }),
          );
        }
      }

      const dailyRows = dailyResult.status === 'fulfilled'
        ? dailyResult.value.filter((row) => outletIds.size === 0 || outletIds.has(String(row.outletId)))
        : [];
      const sessions: PosSessionView[] = sessionsResult.status === 'fulfilled'
        ? (sessionsResult.value.items || []).filter((session) => outletIds.size === 0 || outletIds.has(String(session.outletId ?? '')))
        : [];

      setSnapshot(buildRegionalOpsSnapshot({
        outlets: outletRows,
        dailyRows,
        sessions,
        lowBalancesByOutlet,
      }));
      setPartialError(failedSources.length > 0 ? `Some operational feeds are unavailable: ${failedSources.join(', ')}.` : '');
    } catch (err: unknown) {
      console.error('Regional ops load failed', err);
      setSnapshot(emptySnapshot());
      setError(getErrorMessage(err, 'Regional operations data is currently unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [scopedOutletId, scopedRegionId, selectedPeriodKey, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeLabel = useMemo(() => getScopeLabel(scope, visibleOutlets), [scope, visibleOutlets]);
  const activePeriodKey = selectedPeriodKey || periodOptions[0]?.key || currentPeriodKey();
  const atRiskRows = snapshot.outletRows.filter((row) => row.outOfStockCount > 0 || row.lowStockCount > 0);
  const noSalesRows = snapshot.outletRows.filter((row) => row.orderCount === 0);
  const chartRows = snapshot.outletRows.slice(0, 12);

  if (loading && snapshot.outletsInScope === 0) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <Layers className="h-3 w-3" />
            <span>Regional Ops</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">Scorecard</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">{scopeLabel} Operations Scorecard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatPeriodLabel(activePeriodKey)} · {snapshot.outletsWithSales}/{snapshot.outletsInScope} outlets with sales · live POS and inventory signals
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            value={activePeriodKey}
            onChange={(event) => setSelectedPeriodKey(event.target.value)}
            disabled={periodOptions.length === 0}
          >
            {periodOptions.length === 0 ? (
              <option value={activePeriodKey}>{formatPeriodLabel(activePeriodKey)}</option>
            ) : periodOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="permission-banner permission-banner-unavailable animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">Regional Ops unavailable</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      ) : null}

      {partialError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {partialError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Net Sales', value: formatMoney(snapshot.netSales, snapshot.currency), icon: BarChart3, detail: formatMoney(snapshot.grossSales, snapshot.currency) + ' gross' },
          { label: 'Orders', value: snapshot.orderCount.toLocaleString(), icon: ShoppingCart, detail: formatMoney(snapshot.avgOrderValue, snapshot.currency) + ' AOV' },
          { label: 'Active POS', value: String(snapshot.activeSessions), icon: Wifi, detail: `${snapshot.outletsInScope} outlets in scope` },
          { label: 'Stock Risk', value: String(snapshot.lowStockCount + snapshot.outOfStockCount), icon: AlertTriangle, detail: `${snapshot.outOfStockCount} out of stock` },
          { label: 'Coverage', value: formatPct(snapshot.dataCoveragePct, 0), icon: Store, detail: `${snapshot.outletsWithSales}/${snapshot.outletsInScope} selling` },
        ].map((kpi) => (
          <div key={kpi.label} className="surface-elevated rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground tabular-nums">{kpi.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{kpi.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="surface-elevated rounded-lg overflow-hidden xl:col-span-3">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Outlet sales comparison</span>
            <span className="text-[11px] text-muted-foreground">Top {chartRows.length} by net sales</span>
          </div>
          <div className="p-4">
            {chartRows.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No outlet data in this scope</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(value) => formatMoney(value, snapshot.currency)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="outletCode"
                      width={120}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--card))',
                      }}
                      formatter={(value: number) => [formatMoney(value, snapshot.currency), 'Net sales']}
                      labelFormatter={(label) => chartRows.find((row) => row.outletCode === label)?.outletName || String(label)}
                    />
                    <Bar dataKey="netSales" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="surface-elevated rounded-lg overflow-hidden xl:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Operational exceptions</span>
          </div>
          <div className="divide-y divide-border">
            {atRiskRows.length === 0 && noSalesRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-success" />
                No outlet exceptions for this period
              </div>
            ) : (
              <>
                {atRiskRows.slice(0, 5).map((row) => (
                  <div key={`risk-${row.outletId}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{row.outletCode}</p>
                        <p className="text-xs text-muted-foreground">{row.outletName}</p>
                      </div>
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                        Stock risk
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {row.outOfStockCount} out of stock · {row.lowStockCount} low stock
                    </p>
                  </div>
                ))}
                {noSalesRows.slice(0, Math.max(0, 5 - atRiskRows.length)).map((row) => (
                  <div key={`nosales-${row.outletId}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{row.outletCode}</p>
                        <p className="text-xs text-muted-foreground">{row.outletName}</p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        No sales
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      No completed orders recorded in {formatPeriodLabel(activePeriodKey)}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="surface-elevated rounded-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Outlet operations table</span>
          <span className="text-[11px] text-muted-foreground">Includes outlets with zero sales</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Outlet</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Net Sales</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Orders</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">AOV</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Share</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-medium text-muted-foreground">POS</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Inventory</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.outletRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No outlets in this scope</td>
                </tr>
              ) : snapshot.outletRows.map((row) => (
                <tr key={row.outletId} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{row.outletCode}</p>
                    <p className="text-xs text-muted-foreground">{row.outletName}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-foreground">{formatMoney(row.netSales, snapshot.currency)}</td>
                  <td className="px-4 py-3 text-right text-sm text-foreground">{row.orderCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">{formatMoney(row.avgOrderValue, snapshot.currency)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted/40">
                        <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${Math.min(100, row.sharePct)}%` }} />
                      </div>
                      <span className="w-10 text-right text-[10px] font-mono text-muted-foreground">{formatPct(row.sharePct, 0)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      row.activeSessions > 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                    )}>
                      <Clock3 className="h-3 w-3" />
                      {row.activeSessions}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.outOfStockCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        <XCircle className="h-3 w-3" />
                        {row.outOfStockCount} out
                      </span>
                    ) : row.lowStockCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                        <ArrowDownRight className="h-3 w-3" />
                        {row.lowStockCount} low
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Clear
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                      row.outletStatus.toLowerCase() === 'active'
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground',
                    )}>
                      {row.outletStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
