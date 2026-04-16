/**
 * FinanceLaborWorkspace
 *
 * Enforces separation of duties:
 *   - HR role  → sees "Prepare" tab only (create period, manage timesheets, submit)
 *   - Finance role → sees "Approve" tab only (review queue, approve/reject)
 *   - Superadmin → sees both tabs
 *   - Others with read → read-only summary view
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/use-auth';
import {
  payrollApi,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollTimesheetView,
  type PayrollTimesheetsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  inferPeriodWindowState,
  periodWindowBadgeClass,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';
import { FinancePayrollReviewWorkspace } from '@/components/finance/FinancePayrollReviewWorkspace';
import { resolveCanonicalRoles, formatDateShort, formatMonthYear } from '@/components/finance/finance-utils';

interface Props {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}

type LaborTab = 'prepare' | 'approve';

export function FinanceLaborWorkspace({
  token,
  scopeRegionId,
  scopeOutletId,
  regions,
  outlets,
}: Props) {
  const { session } = useAuth();

  const roles = resolveCanonicalRoles(session?.rolesByOutlet);
  const isSuperadmin = roles.has('superadmin');
  const isHr = roles.has('hr');
  const isFinance = roles.has('finance');
  const canPrepare = isSuperadmin || isHr;
  const canApprove = isSuperadmin || isFinance;

  // Default tab: superadmin sees approve; hr-only sees prepare; finance-only sees approve
  const defaultTab: LaborTab = canApprove ? 'approve' : 'prepare';
  const [activeTab, setActiveTab] = useState<LaborTab>(defaultTab);

  const sharedProps = {
    token,
    scopeRegionId,
    scopeOutletId,
    regions,
    outlets,
  };

  // Users with neither prepare nor approve — read-only summary
  if (!canPrepare && !canApprove) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="surface-elevated px-5 py-4">
          <h3 className="text-lg font-semibold">Labor & Payroll</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only summary. You can view payroll period status but cannot prepare or approve payroll runs.
          </p>
        </div>
        <div className="surface-elevated px-5 py-6 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          Payroll detail requires HR or Finance role.
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-0">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b bg-muted/30 px-6">
        {/* HR — Prepare tab */}
        {canPrepare && (
          <button
            onClick={() => setActiveTab('prepare')}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors',
              activeTab === 'prepare'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            HR — Prepare
          </button>
        )}

        {/* Finance — Approve tab */}
        {canApprove && (
          <button
            onClick={() => setActiveTab('approve')}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors',
              activeTab === 'approve'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Finance — Approve
          </button>
        )}

        {/* Separation of duties badge */}
        <div className="ml-auto flex items-center gap-1.5 py-2.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          HR prepares · Finance approves
        </div>
      </div>

      {/* Separation of duties notice */}
      {isSuperadmin && (
        <div className="border-b border-amber-200 bg-amber-50/60 px-6 py-2.5 text-[11px] text-amber-800">
          <span className="font-medium">Superadmin:</span> You can see both tabs. In normal operation HR prepares and Finance approves — they cannot do each other's action.
        </div>
      )}
      {isHr && !isSuperadmin && activeTab === 'prepare' && (
        <div className="border-b border-blue-200 bg-blue-50/60 px-6 py-2.5 text-[11px] text-blue-800">
          <span className="font-medium">HR role:</span> You can prepare and submit payroll periods for Finance approval. You cannot approve payroll.
        </div>
      )}
      {isFinance && !isSuperadmin && activeTab === 'approve' && (
        <div className="border-b border-blue-200 bg-blue-50/60 px-6 py-2.5 text-[11px] text-blue-800">
          <span className="font-medium">Finance role:</span> You can review and approve draft payroll runs submitted by HR. You cannot create or edit timesheets.
        </div>
      )}

      <div className="p-6">
        {activeTab === 'approve' ? (
          <FinancePayrollReviewWorkspace {...sharedProps} />
        ) : (
          // HR Prepare tab — placeholder until HR timesheet create UI is built
          <HrPrepareView {...sharedProps} />
        )}
      </div>
    </div>
  );
}

/**
 * HR Prepare view — live payroll period status + timesheet counts.
 * HR can monitor period readiness here; creation still happens in the HR module.
 */
function HrPrepareView({
  token,
  scopeRegionId,
  outlets,
}: {
  token: string;
  scopeRegionId?: string;
  scopeOutletId?: string;
  regions: ScopeRegion[];
  outlets: ScopeOutlet[];
}) {
  const [loading, setLoading] = useState(false);
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      // 1. Load periods scoped to region (backend supports regionId on periods)
      const ps = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
        (q) => payrollApi.periods(token, q),
        { regionId: scopeRegionId || undefined },
        20, 5,
      );
      const sortedPeriods = ps.sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
      setPeriods(sortedPeriods);

      // 2. Load timesheets — backend does NOT support regionId on timesheets,
      //    so we load all and filter client-side by the period IDs from step 1
      const periodIds = new Set(sortedPeriods.map((p) => String(p.id ?? '')));
      let allTimesheets: PayrollTimesheetView[] = [];
      if (periodIds.size > 0) {
        const tsRaw = await collectPagedItems<PayrollTimesheetView, PayrollTimesheetsQuery>(
          (q) => payrollApi.timesheets(token, q),
          {},
          100, 5,
        );
        allTimesheets = tsRaw.filter((t) => periodIds.has(String(t.payrollPeriodId ?? '')));
      }
      setTimesheets(allTimesheets);

      if (sortedPeriods.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(String(sortedPeriods[0].id ?? ''));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load payroll periods');
    } finally {
      setLoading(false);
    }
  }, [token, scopeRegionId, selectedPeriodId]);

  useEffect(() => { void load(); }, [load]);

  const selectedPeriod = periods.find((p) => String(p.id ?? '') === selectedPeriodId) ?? null;
  const periodTimesheets = timesheets.filter((t) => String(t.payrollPeriodId ?? '') === selectedPeriodId);

  // Group timesheets by outlet
  const outletMap = new Map<string, ScopeOutlet>(outlets.map((o) => [o.id, o]));
  const byOutlet = new Map<string, PayrollTimesheetView[]>();
  for (const ts of periodTimesheets) {
    const key = String(ts.outletId ?? 'unknown');
    byOutlet.set(key, [...(byOutlet.get(key) ?? []), ts]);
  }

  const windowState = selectedPeriod ? inferPeriodWindowState(selectedPeriod) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">HR — Prepare Payroll</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monitor period readiness. Create periods and timesheets in the HR module.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && periods.length === 0 ? (
        <div className="surface-elevated px-5 py-10 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-3 h-6 w-6 animate-pulse text-muted-foreground/40" />
          Loading payroll periods…
        </div>
      ) : periods.length === 0 ? (
        <div className="surface-elevated px-5 py-10 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-3 h-7 w-7 text-muted-foreground/30" />
          <p className="font-medium">No payroll periods found</p>
          <p className="mt-1 text-xs">Create a period in <strong>HR → Payroll → Periods</strong></p>
        </div>
      ) : (
        <div className="grid grid-cols-[220px_1fr] gap-4">
          {/* Period list */}
          <div className="surface-elevated overflow-hidden">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Periods</p>
            </div>
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {periods.map((p) => {
                const ws = inferPeriodWindowState(p);
                const isSelected = String(p.id ?? '') === selectedPeriodId;
                const periodTs = timesheets.filter((t) => String(t.payrollPeriodId ?? '') === String(p.id ?? ''));
                return (
                  <button
                    key={String(p.id)}
                    onClick={() => setSelectedPeriodId(String(p.id ?? ''))}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors hover:bg-muted/40',
                      isSelected && 'bg-muted/60',
                    )}
                  >
                    <p className="text-xs font-medium truncate">
                      {p.name || formatMonthYear(p.startDate) || 'Unnamed period'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateShort(p.startDate)} → {formatDateShort(p.endDate)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={cn('inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium', periodWindowBadgeClass(ws))}>
                        {periodWindowLabel(ws)}
                      </span>
                      {periodTs.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">{periodTs.length} sheets</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Period detail */}
          <div className="space-y-3">
            {selectedPeriod && (
              <>
                <div className="surface-elevated px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-semibold">
                        {selectedPeriod.name || formatMonthYear(selectedPeriod.startDate) || 'Payroll period'}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateShort(selectedPeriod.startDate)} → {formatDateShort(selectedPeriod.endDate)}
                        {selectedPeriod.payDate ? ` · Pay date ${formatDateShort(selectedPeriod.payDate)}` : ''}
                      </p>
                    </div>
                    {windowState && (
                      <span className={cn('inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', periodWindowBadgeClass(windowState))}>
                        {periodWindowLabel(windowState)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Timesheets</p>
                      <p className="mt-0.5 text-lg font-semibold">{periodTimesheets.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Outlets covered</p>
                      <p className="mt-0.5 text-lg font-semibold">{byOutlet.size}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Approved sheets</p>
                      <p className="mt-0.5 text-lg font-semibold">
                        {periodTimesheets.filter((t) => String(t.status ?? '').toLowerCase() === 'approved').length}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Outlet breakdown */}
                {byOutlet.size > 0 ? (
                  <div className="surface-elevated overflow-hidden">
                    <div className="border-b px-5 py-3">
                      <p className="text-xs font-semibold">Timesheet status by outlet</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Outlet</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Sheets</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Approved</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(byOutlet.entries()).map(([outletId, sheets]) => {
                          const outlet = outletMap.get(outletId);
                          const approved = sheets.filter((s) => String(s.status ?? '').toLowerCase() === 'approved').length;
                          const allApproved = approved === sheets.length;
                          return (
                            <tr key={outletId} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-2.5">
                                <p className="text-xs font-medium">{outlet?.name ?? outletId}</p>
                                {outlet?.code && <p className="text-[11px] text-muted-foreground">{outlet.code}</p>}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs">{sheets.length}</td>
                              <td className="px-4 py-2.5 text-right text-xs">{approved}</td>
                              <td className="px-4 py-2.5">
                                {allApproved ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                                    <Clock className="h-3.5 w-3.5" /> {sheets.length - approved} pending
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="surface-elevated px-5 py-8 text-center text-sm text-muted-foreground">
                    <Clock className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
                    No timesheets yet for this period.
                    <p className="mt-1 text-xs">Add timesheets in <strong>HR → Payroll → Timesheets</strong></p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
