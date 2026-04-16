import { useCallback, useEffect, useMemo, useState } from 'react';
import { PieChart, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  financeApi,
  payrollApi,
  type ExpenseView,
  type PayrollRunView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { collectPagedItems } from '@/lib/collect-paged-items';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
  onNavigate: (tab: string) => void;
}

function toNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

interface OutletCostRow {
  outletId: string;
  outletCode: string;
  outletName: string;
  payroll: number;
  otherExpenses: number;
  totalOpCost: number;
  currency: string;
}

export function FinancePrimeCostWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
  onNavigate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);

  const scopedRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((o) => o.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [expPage, runItems] = await Promise.all([
        financeApi.expenses(token, {
          outletId: scopeOutletId || undefined,
          limit: 500,
          sortBy: 'businessDate',
          sortDir: 'desc',
        }),
        collectPagedItems<PayrollRunView>(
          (q) => payrollApi.runs(token, q),
          {
            outletId: scopeOutletId || undefined,
            sortBy: 'userId',
            sortDir: 'asc',
          },
          500,
        ),
      ]);
      setExpenses(expPage.items || []);
      setRuns(runItems);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load cost data'));
    } finally {
      setLoading(false);
    }
  }, [token, scopeOutletId]);

  useEffect(() => { void load(); }, [load]);

  const outletRows = useMemo((): OutletCostRow[] => {
    const relevantOutlets = scopeOutletId
      ? outlets.filter((o) => o.id === scopeOutletId)
      : outlets.filter((o) => !scopedRegionId || o.regionId === scopedRegionId);

    return relevantOutlets.map((outlet): OutletCostRow => {
      const outletRuns = runs.filter((r) => String(r.outletId) === outlet.id);
      const outletExpenses = expenses.filter((e) => String(e.outletId) === outlet.id);

      const payroll = outletRuns
        .filter((r) => String(r.status || '').toLowerCase() === 'approved')
        .reduce((sum, r) => sum + toNumber(r.netSalary), 0);

      const otherExpenses = outletExpenses
        .filter((e) => String(e.subtype || e.sourceType || '').toLowerCase() !== 'payroll')
        .reduce((sum, e) => sum + toNumber(e.amount), 0);

      const currency = outletExpenses[0]?.currencyCode
        ?? outletRuns[0]?.currencyCode
        ?? 'USD';

      return {
        outletId: outlet.id,
        outletCode: outlet.code || outlet.id,
        outletName: outlet.name || outlet.id,
        payroll,
        otherExpenses,
        totalOpCost: payroll + otherExpenses,
        currency: String(currency),
      };
    }).sort((a, b) => b.totalOpCost - a.totalOpCost);
  }, [outlets, scopeOutletId, scopedRegionId, runs, expenses]);

  const totals = useMemo(() => {
    return outletRows.reduce(
      (acc, row) => ({
        payroll: acc.payroll + row.payroll,
        otherExpenses: acc.otherExpenses + row.otherExpenses,
        totalOpCost: acc.totalOpCost + row.totalOpCost,
      }),
      { payroll: 0, otherExpenses: 0, totalOpCost: 0 },
    );
  }, [outletRows]);

  const currency = outletRows[0]?.currency ?? 'USD';

  return (
    <div className="animate-fade-in space-y-5">
      <div className="surface-elevated px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <PieChart className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-semibold">Prime Cost & Variance</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Operating cost breakdown by outlet. Prime Cost % and margin require revenue data (Phase 2).
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded border px-3 text-xs hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Phase 2 notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
        <span className="font-medium">Partial view (Phase 1):</span> Payroll and expense costs per outlet are shown below.
        {' '}<span className="text-blue-700">Prime Cost %, Labor % of sales, and outlet heatmap require revenue + COGS integration (Phase 2).</span>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Chain totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="surface-elevated px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Payroll (approved runs)</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(totals.payroll, currency)}</p>
        </div>
        <div className="surface-elevated px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Other Expenses</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(totals.otherExpenses, currency)}</p>
        </div>
        <div className="surface-elevated px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Total Op Cost</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(totals.totalOpCost, currency)}</p>
        </div>
      </div>

      {/* Outlet cost breakdown table */}
      <div className="surface-elevated overflow-hidden">
        <div className="border-b px-5 py-4">
          <h3 className="text-sm font-semibold">Outlet cost breakdown</h3>
          <p className="text-xs text-muted-foreground">
            Approved payroll + non-payroll expenses per outlet. Revenue column requires Phase 2.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Outlet', 'Payroll', 'Other Expenses', 'Total Op Cost', 'Net Sales', 'Prime Cost %'].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      'px-4 py-2.5 text-[11px] font-medium',
                      ['Payroll', 'Other Expenses', 'Total Op Cost', 'Net Sales', 'Prime Cost %'].includes(h)
                        ? 'text-right'
                        : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && outletRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td>
                </tr>
              ) : outletRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No outlet data in current scope.
                  </td>
                </tr>
              ) : (
                outletRows.map((row) => (
                  <tr key={row.outletId} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{row.outletCode}</span>
                        <span className="text-[11px] text-muted-foreground">{row.outletName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatCurrency(row.payroll, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatCurrency(row.otherExpenses, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                      {formatCurrency(row.totalOpCost, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      — (Phase 2)
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      — (Phase 2)
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phase 2 preview */}
      <div className="surface-elevated px-5 py-4 opacity-70">
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Phase 2 — Planned additions</h3>
        <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground xl:grid-cols-4">
          <div className="rounded-lg border border-dashed border-muted-foreground/30 px-3 py-3">
            <p className="font-medium">Outlet heatmap</p>
            <p className="mt-1">Color-coded PC% grid across all outlets with variance from chain average</p>
          </div>
          <div className="rounded-lg border border-dashed border-muted-foreground/30 px-3 py-3">
            <p className="font-medium">Labor % of sales</p>
            <p className="mt-1">Payroll / Net Sales per outlet with amber/red thresholds</p>
          </div>
          <div className="rounded-lg border border-dashed border-muted-foreground/30 px-3 py-3">
            <p className="font-medium">Period comparison</p>
            <p className="mt-1">PC% current vs prior period trend chart</p>
          </div>
          <div className="rounded-lg border border-dashed border-muted-foreground/30 px-3 py-3">
            <p className="font-medium">Variance flags</p>
            <p className="mt-1">Auto-flag outlets above configurable thresholds</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onNavigate('expenses')}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          View expense detail →
        </button>
        <button
          onClick={() => onNavigate('labor')}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          View payroll review →
        </button>
      </div>
    </div>
  );
}
