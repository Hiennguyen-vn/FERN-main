import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type {
  ScopeOutlet,
  ScopeRegion,
} from '@/api/fern-api';
import type { FinanceTab } from '@/components/finance/finance-workspace-config';
import {
  buildFinancePeriodOptions,
  buildRevenueSnapshot,
  describeFinanceScope,
  findPeriodComparison,
  formatPeriodLabel,
  type RevenueChannelFilter,
} from '@/components/finance/finance-phase2-utils';
import { formatMoney } from '@/components/finance/finance-utils';
import { useFinanceSalesOrders } from '@/components/finance/use-finance-sales-orders';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  onNavigate: (tab: FinanceTab) => void;
}

const MIX_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--primary) / 0.78)',
  'hsl(var(--primary) / 0.56)',
  'hsl(var(--primary) / 0.34)',
];

function formatDelta(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'New baseline';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export function FinanceRevenueWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
  onNavigate,
}: Props) {
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('');
  const [channelFilter, setChannelFilter] = useState<RevenueChannelFilter>('all');
  const [metric, setMetric] = useState<'netSales' | 'grossSales' | 'discounts'>('netSales');
  const {
    orders,
    visibleOutlets,
    loading,
    error,
    refresh,
  } = useFinanceSalesOrders({
    token,
    scopeRegionId,
    scopeOutletId,
    outlets,
  });

  const periodOptions = useMemo(
    () => buildFinancePeriodOptions(orders),
    [orders],
  );

  useEffect(() => {
    setSelectedPeriodKey((current) => {
      if (current && periodOptions.some((option) => option.key === current)) {
        return current;
      }
      return periodOptions[0]?.key || '';
    });
  }, [periodOptions]);

  const activePeriodKey = selectedPeriodKey || periodOptions[0]?.key || '';
  const comparisonPeriod = useMemo(
    () => findPeriodComparison(periodOptions, activePeriodKey),
    [activePeriodKey, periodOptions],
  );
  const snapshot = useMemo(
    () =>
      buildRevenueSnapshot({
        orders,
        visibleOutlets,
        periodKey: activePeriodKey,
        channelFilter,
      }),
    [activePeriodKey, channelFilter, orders, visibleOutlets],
  );
  const comparisonSnapshot = useMemo(
    () =>
      comparisonPeriod
        ? buildRevenueSnapshot({
            orders,
            visibleOutlets,
            periodKey: comparisonPeriod.key,
            channelFilter,
          })
        : null,
    [channelFilter, comparisonPeriod, orders, visibleOutlets],
  );

  const scopeLabel = useMemo(
    () =>
      describeFinanceScope({
        scopeRegionId,
        scopeOutletId,
        regions,
        outlets,
      }),
    [outlets, regions, scopeOutletId, scopeRegionId],
  );

  const revenueDeltaPct = comparisonSnapshot && comparisonSnapshot.netSales > 0
    ? ((snapshot.netSales - comparisonSnapshot.netSales) / comparisonSnapshot.netSales) * 100
    : null;
  const hasData = snapshot.completedOrderCount > 0 || snapshot.voids > 0;

  return (
    <div className="animate-fade-in space-y-5">
      {/* Compact header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{scopeLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {formatPeriodLabel(activePeriodKey)} · {snapshot.completedOrderCount} completed orders
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            value={activePeriodKey}
            onChange={(event) => setSelectedPeriodKey(event.target.value)}
          >
            {periodOptions.length === 0 ? (
              <option value="">No periods</option>
            ) : (
              periodOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))
            )}
          </select>
          <select
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value as RevenueChannelFilter)}
          >
            <option value="all">All channels</option>
            <option value="dine_in">Dine-in</option>
            <option value="delivery">Delivery</option>
            <option value="takeaway">Takeout</option>
          </select>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="surface-elevated rounded-lg px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">Net Sales</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(snapshot.netSales, snapshot.currency)}</p>
          {comparisonPeriod ? (
            <span className={cn(
              'mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              revenueDeltaPct != null && revenueDeltaPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
            )}>{formatDelta(revenueDeltaPct)}</span>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">Latest period</p>
          )}
        </div>
        <div className="surface-elevated rounded-lg px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">Gross Sales</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(snapshot.grossSales, snapshot.currency)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Before discounts</p>
        </div>
        <div className="surface-elevated rounded-lg px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">Discounts</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(snapshot.discounts, snapshot.currency)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Applied to orders</p>
        </div>
        <div className="surface-elevated rounded-lg px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">Voids</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(snapshot.voids, snapshot.currency)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Cancelled orders</p>
        </div>
        <div className="surface-elevated rounded-lg px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">Avg Order</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(snapshot.avgOrderValue, snapshot.currency)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{snapshot.completedOrderCount} orders</p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!hasData && !loading ? (
        <div className="surface-elevated px-6 py-14 text-center">
          <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground/35" />
          <h3 className="mt-4 text-lg font-semibold">No completed orders in this period</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Orders will appear here as they are completed in the POS. Try selecting a different period or scope.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => onNavigate('overview')}
              className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent"
            >
              Back to Overview
            </button>
            <button
              onClick={() => onNavigate('expenses')}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              View Operating Expenses
            </button>
          </div>
        </div>
      ) : null}

      {hasData ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <section className="surface-elevated overflow-hidden">
              <div className="flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Daily revenue trend</h3>
                  <p className="text-xs text-muted-foreground">
                    Net sales by day for the selected period.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {[
                    { key: 'netSales', label: 'Net' },
                    { key: 'grossSales', label: 'Gross' },
                    { key: 'discounts', label: 'Discounts' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setMetric(option.key as 'netSales' | 'grossSales' | 'discounts')}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs transition-colors',
                        metric === option.key
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[320px] px-3 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={snapshot.trend}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={70}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(value) => formatMoney(Number(value), snapshot.currency)}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--card))',
                        fontSize: 12,
                      }}
                      formatter={(value: number) => formatMoney(Number(value), snapshot.currency)}
                    />
                    <Area
                      type="monotone"
                      dataKey={metric}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#revenueGradient)"
                      dot={{ r: 4, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                      activeDot={{ r: 6, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: 'hsl(var(--card))' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <div className="space-y-6">
              <section className="surface-elevated overflow-hidden">
                <div className="border-b px-6 py-4">
                  <h3 className="text-sm font-semibold">Payment mix</h3>
                  <p className="text-xs text-muted-foreground">
                    Based on payment metadata attached to completed orders.
                  </p>
                </div>
                {snapshot.paymentCoveragePct === 0 ? (
                  <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                    <p className="text-sm text-muted-foreground">No payment method data available.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Record payment methods at the POS to see this breakdown.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 px-4 py-4">
                    <div className="h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={snapshot.paymentMix}
                            dataKey="amount"
                            nameKey="label"
                            innerRadius={46}
                            outerRadius={74}
                            paddingAngle={3}
                          >
                            {snapshot.paymentMix.map((row, index) => (
                              <Cell key={row.key} fill={MIX_COLORS[index % MIX_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              borderRadius: 12,
                              border: '1px solid hsl(var(--border))',
                              background: 'hsl(var(--card))',
                              fontSize: 12,
                            }}
                            formatter={(value: number) => formatMoney(Number(value), snapshot.currency)}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {snapshot.paymentMix.map((row, index) => (
                        <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: MIX_COLORS[index % MIX_COLORS.length] }}
                            />
                            <span>{row.label}</span>
                          </div>
                          <span className="font-mono text-muted-foreground">{row.pct.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="surface-elevated overflow-hidden">
                <div className="border-b px-6 py-4">
                  <h3 className="text-sm font-semibold">Channel mix</h3>
                  <p className="text-xs text-muted-foreground">
                    Revenue split by service mode in the selected period.
                  </p>
                </div>
                <div className="space-y-3 px-6 py-4">
                  {snapshot.channelMix.map((row) => (
                    <div key={row.key} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span>{row.label}</span>
                        <span className="font-mono text-muted-foreground">{row.pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <section className="surface-elevated overflow-hidden">
            <div className="flex flex-col gap-3 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Outlet revenue table</h3>
                <p className="text-xs text-muted-foreground">
                  Ranked by net sales for {formatPeriodLabel(activePeriodKey)}.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {visibleOutlets.length > 1 ? `${visibleOutlets.length} outlets in scope` : 'Single outlet scope'}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Outlet', 'Gross', 'Discounts', 'Voids', 'Net Sales', 'Orders', 'AOV', 'Share', 'Lead mix'].map((header) => (
                      <th
                        key={header}
                        className={cn(
                          'px-4 py-2.5 text-[11px] font-medium',
                          ['Gross', 'Discounts', 'Voids', 'Net Sales', 'Orders', 'AOV', 'Share'].includes(header)
                            ? 'text-right'
                            : 'text-left',
                        )}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.outletRows.map((row) => (
                    <tr key={row.outletId} className="border-b last:border-0 transition-colors hover:bg-accent/20">
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{row.outletCode}</span>
                          <span className="text-xs text-muted-foreground">{row.outletName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatMoney(row.grossSales, snapshot.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatMoney(row.discounts, snapshot.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatMoney(row.voids, snapshot.currency)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold">{formatMoney(row.netSales, snapshot.currency)}</td>
                      <td className="px-4 py-3 text-right text-sm">{row.orderCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">{formatMoney(row.avgOrderValue, snapshot.currency)}</td>
                      <td className="px-4 py-3 text-right text-sm">{row.sharePct.toFixed(0)}%</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col text-xs">
                          <span>{row.paymentLead}</span>
                          <span className="text-muted-foreground">{row.channelLead}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onNavigate('labor')}
          className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent"
        >
          View Labor & Payroll
        </button>
        <button
          onClick={() => onNavigate('prime-cost')}
          className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent"
        >
          Open Prime Cost
        </button>
      </div>
    </div>
  );
}
