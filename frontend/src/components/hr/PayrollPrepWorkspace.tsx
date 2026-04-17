import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  hrApi,
  payrollApi,
  type AuthScopeView,
  type AuthUserListItem,
  type CalculateSalaryResult,
  type ContractView,
  type PayrollPeriodView,
  type PayrollPeriodsQuery,
  type PayrollRunView,
  type PayrollRunsQuery,
  type PayrollTimesheetView,
  type PayrollTimesheetsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { EmptyState } from '@/components/shell/PermissionStates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  formatHrEnumLabel,
  getHrOutletDisplay,
  getHrUserDisplay,
  payrollBadgeClass,
  shortHrRef,
} from '@/components/hr/hr-display';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  buildContractDrivenPayrollRoster,
  collectRegionScopeIds,
  inferPeriodWindowState,
  periodWindowBadgeClass,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';
import { cn } from '@/lib/utils';

interface PayrollPrepWorkspaceProps {
  token: string;
  users: AuthUserListItem[];
  outlets: ScopeOutlet[];
  regions: ScopeRegion[];
  scopeRegionId?: string;
  scopeOutletId?: string;
}

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown, currency = 'VND') {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function formatDateRange(s?: string | null, e?: string | null) {
  if (!s && !e) return '—';
  return `${formatDate(s)} – ${formatDate(e)}`;
}

function formatMonthYear(value?: string | null) {
  if (!value) return 'Payroll prep';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'Payroll prep';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
}

function formatDateInput(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function getRegionName(regionsById: Map<string, ScopeRegion>, regionId?: string | number | null) {
  const key = normalizeValue(regionId);
  if (!key) return 'Selected region';
  return regionsById.get(key)?.name || `Region ${key}`;
}

function buildPeriodHeadline(period: PayrollPeriodView | null, regionName: string) {
  const name = normalizeValue(period?.name);
  if (name) return name;
  return `${formatMonthYear(period?.startDate || period?.endDate || period?.payDate)} · ${regionName}`;
}

function buildDefaultPeriodForm(regionId = '') {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return {
    regionId,
    name: '',
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    payDate: formatDateInput(payDate),
    note: '',
  };
}

function buildDefaultTimesheetForm(outletId = '') {
  return {
    userId: '',
    outletId,
    workDays: '',
    workHours: '',
    overtimeHours: '0',
    overtimeRate: '1.5',
    lateCount: '0',
    absentDays: '0',
  };
}

function buildDefaultRunForm() {
  return {
    payrollTimesheetId: '',
    currencyCode: 'VND',
    baseSalaryAmount: '',
    netSalary: '',
    note: '',
  };
}

/* ------------------------------------------------------------------ */
/*  Field helper                                                        */
/* ------------------------------------------------------------------ */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/* ------------------------------------------------------------------ */
/*  Step 2 — full-width review component                               */
/* ------------------------------------------------------------------ */
interface Step2Props {
  timesheetRows: { ts: PayrollTimesheetView; run: PayrollRunView | undefined }[];
  payrollRoster: { userId: string; fullName: string; employeeCode: string; preferredOutletId: string; outletLabels: string[]; contract: ContractView }[];
  timesheets: PayrollTimesheetView[];
  workspaceLoading: boolean;
  busyKey: string;
  selectedPeriod: PayrollPeriodView | null;
  timesheetForm: ReturnType<typeof buildDefaultTimesheetForm>;
  setTimesheetForm: React.Dispatch<React.SetStateAction<ReturnType<typeof buildDefaultTimesheetForm>>>;
  selectedEmployee: { fullName: string; employeeCode: string; outletLabels: string[]; contract: ContractView } | undefined;
  selectedRegionOutlets: ScopeOutlet[];
  usersById: Map<string, AuthUserListItem>;
  outletsById: Map<string, ScopeOutlet>;
  summary: { rosterCount: number; timesheetCount: number; draftRuns: number; approvedRuns: number };
  createTimesheet: () => Promise<void>;
  importFromAttendance: () => Promise<void>;
  onNext: () => void;
}

function Step2ReviewTimesheets({
  timesheetRows,
  payrollRoster,
  timesheets,
  workspaceLoading,
  busyKey,
  selectedPeriod,
  timesheetForm,
  setTimesheetForm,
  selectedEmployee,
  selectedRegionOutlets,
  usersById,
  outletsById,
  summary,
  createTimesheet,
  importFromAttendance,
  onNext,
}: Step2Props) {
  const [addOpen, setAddOpen] = useState(false);

  // Build a set of userIds that already have a timesheet
  const coveredUserIds = useMemo(
    () => new Set(timesheets.map((ts) => normalizeValue(ts.userId))),
    [timesheets],
  );

  const missingCount = payrollRoster.filter((e) => !coveredUserIds.has(e.userId)).length;

  // Merge roster missing entries with timesheet rows for the table
  type ReviewRow =
    | { kind: 'ts'; ts: PayrollTimesheetView; run: PayrollRunView | undefined }
    | { kind: 'missing'; userId: string; fullName: string; outletLabel: string };

  const reviewRows = useMemo<ReviewRow[]>(() => {
    const rows: ReviewRow[] = timesheetRows.map(({ ts, run }) => ({ kind: 'ts', ts, run }));
    for (const entry of payrollRoster) {
      if (!coveredUserIds.has(entry.userId)) {
        rows.push({ kind: 'missing', userId: entry.userId, fullName: entry.fullName, outletLabel: entry.outletLabels[0] || '—' });
      }
    }
    return rows;
  }, [timesheetRows, payrollRoster, coveredUserIds]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="border-b px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Review imported timesheets</p>
          <p className="text-[11px] text-muted-foreground">
            {summary.timesheetCount} of {summary.rosterCount} employees have timesheets
            {missingCount > 0 ? ` · ${missingCount} missing` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent',
              addOpen ? 'bg-accent' : '',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add manually
          </button>
          <button
            onClick={onNext}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Next: Generate Runs →
          </button>
        </div>
      </div>

      {/* Inline add form — collapsed by default */}
      {addOpen ? (
        <div className="border-b bg-muted/20 px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <div className="sm:col-span-2 lg:col-span-2 xl:col-span-2">
              <Field label="Employee">
                <select
                  value={timesheetForm.userId}
                  onChange={(e) => setTimesheetForm((cur) => ({ ...cur, userId: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Select employee</option>
                  {payrollRoster.map((entry) => (
                    <option key={entry.userId} value={entry.userId}>
                      {entry.fullName}{entry.employeeCode ? ` · ${entry.employeeCode}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedEmployee ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatHrEnumLabel(selectedEmployee.contract.employmentType)}
                  {selectedEmployee.outletLabels.length > 0 ? ` · ${selectedEmployee.outletLabels.join(', ')}` : ''}
                </p>
              ) : null}
            </div>

            <div className="sm:col-span-2 lg:col-span-2 xl:col-span-1">
              <Field label="Outlet">
                <select
                  value={timesheetForm.outletId}
                  onChange={(e) => setTimesheetForm((cur) => ({ ...cur, outletId: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Select outlet</option>
                  {selectedRegionOutlets.map((o) => (
                    <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-2">
              <Field label="Work days">
                <input type="number" value={timesheetForm.workDays} onChange={(e) => setTimesheetForm((c) => ({ ...c, workDays: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Work hours">
                <input type="number" value={timesheetForm.workHours} onChange={(e) => setTimesheetForm((c) => ({ ...c, workHours: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="OT hours">
                <input type="number" value={timesheetForm.overtimeHours} onChange={(e) => setTimesheetForm((c) => ({ ...c, overtimeHours: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="OT rate">
                <input type="number" value={timesheetForm.overtimeRate} onChange={(e) => setTimesheetForm((c) => ({ ...c, overtimeRate: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Late count">
                <input type="number" value={timesheetForm.lateCount} onChange={(e) => setTimesheetForm((c) => ({ ...c, lateCount: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Absent days">
                <input type="number" value={timesheetForm.absentDays} onChange={(e) => setTimesheetForm((c) => ({ ...c, absentDays: e.target.value }))} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void importFromAttendance()}
              disabled={busyKey === 'import-timesheet' || !selectedPeriod}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              <Clock className="h-3.5 w-3.5" />
              {busyKey === 'import-timesheet' ? 'Importing…' : 'From Attendance'}
            </button>
            <button
              onClick={() => void createTimesheet()}
              disabled={busyKey === 'create-timesheet' || !selectedPeriod}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <FileText className="h-3.5 w-3.5" />
              {busyKey === 'create-timesheet' ? 'Saving…' : 'Save manually'}
            </button>
            <button
              onClick={() => setAddOpen(false)}
              className="ml-auto inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-width timesheet table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b bg-background">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Employee</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Outlet</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Work Days</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Work Hours</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">OT Hours</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Late</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Absent</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workspaceLoading && reviewRows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>
            ) : reviewRows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No timesheets yet — run the bulk import in Step 1 or add manually above</td></tr>
            ) : reviewRows.map((row) => {
              if (row.kind === 'missing') {
                return (
                  <tr key={`missing-${row.userId}`} className="border-b last:border-0 bg-amber-50/40 hover:bg-amber-50/60">
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-medium text-muted-foreground">{row.fullName}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.outletLabel}</td>
                    <td colSpan={6} className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        Missing
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => { setTimesheetForm((c) => ({ ...c, userId: row.userId })); setAddOpen(true); }}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                );
              }
              const { ts, run } = row;
              return (
                <tr key={ts.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <p className="text-xs font-medium">{getHrUserDisplay(usersById, ts.userId).primary}</p>
                    <p className="text-[10px] text-muted-foreground">{shortHrRef(ts.id)}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{getHrOutletDisplay(outletsById, ts.outletId).primary}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">{toNumber(ts.workDays)}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">{toNumber(ts.workHours).toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">{toNumber(ts.overtimeHours).toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">{toNumber(ts.lateCount ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">{toNumber(ts.absentDays ?? 0)}</td>
                  <td className="px-4 py-2.5">
                    {run ? (
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', payrollBadgeClass(run.status))}>
                        {formatHrEnumLabel(run.status)}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-muted bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        No run
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] text-muted-foreground">—</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom action bar */}
      <div className="border-t px-6 py-3 flex items-center justify-between bg-background">
        <p className="text-[11px] text-muted-foreground">
          {summary.timesheetCount} of {summary.rosterCount} employees have timesheets
          {missingCount > 0 ? (
            <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              {missingCount} missing
            </span>
          ) : null}
        </p>
        <button
          onClick={onNext}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Next: Generate Runs →
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
export function PayrollPrepWorkspace({
  token,
  users,
  outlets,
  regions,
  scopeRegionId,
  scopeOutletId,
}: PayrollPrepWorkspaceProps) {
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [authScopes, setAuthScopes] = useState<AuthScopeView[]>([]);
  const [contracts, setContracts] = useState<ContractView[]>([]);

  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodsError, setPeriodsError] = useState('');
  const [periods, setPeriods] = useState<PayrollPeriodView[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [timesheets, setTimesheets] = useState<PayrollTimesheetView[]>([]);
  const [runs, setRuns] = useState<PayrollRunView[]>([]);

  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState(buildDefaultPeriodForm(scopeRegionId || ''));
  const [timesheetForm, setTimesheetForm] = useState(buildDefaultTimesheetForm(scopeOutletId || ''));
  const [runForm, setRunForm] = useState(buildDefaultRunForm());
  const [busyKey, setBusyKey] = useState('');
  const [prepStep, setPrepStep] = useState<1 | 2 | 3>(1);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; failed: number } | null>(null);
  const [salaryCalc, setSalaryCalc] = useState<CalculateSalaryResult | null>(null);

  // Reset step on period change; auto-advance to step 2 when timesheets already loaded
  const prevPeriodIdRef = useRef('');
  useEffect(() => {
    if (selectedPeriodId !== prevPeriodIdRef.current) {
      prevPeriodIdRef.current = selectedPeriodId;
      setPrepStep(1);
    }
  }, [selectedPeriodId]);

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (!workspaceLoading && prevLoadingRef.current && timesheets.length > 0 && prepStep === 1) {
      setPrepStep(2);
    }
    prevLoadingRef.current = workspaceLoading;
  }, [workspaceLoading, timesheets.length, prepStep]);

  /* ---- derived maps ---- */
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const regionsById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const outletsById = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);

  const inferredRegionId = useMemo(() => {
    if (scopeRegionId) return scopeRegionId;
    if (!scopeOutletId) return '';
    return outlets.find((o) => o.id === scopeOutletId)?.regionId || '';
  }, [outlets, scopeOutletId, scopeRegionId]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const selectedRegionId = useMemo(
    () => normalizeValue(selectedPeriod?.regionId || periodForm.regionId || inferredRegionId),
    [inferredRegionId, periodForm.regionId, selectedPeriod?.regionId],
  );

  const selectedRegionScopeIds = useMemo(
    () => collectRegionScopeIds(regions, selectedRegionId),
    [regions, selectedRegionId],
  );

  const selectedRegionCodes = useMemo(
    () => selectedRegionScopeIds.map((id) => regionsById.get(id)?.code).filter((c): c is string => Boolean(c)),
    [regionsById, selectedRegionScopeIds],
  );

  const availablePeriodRegions = useMemo(() => {
    if (!inferredRegionId) return regions;
    const allowed = new Set(collectRegionScopeIds(regions, inferredRegionId));
    return regions.filter((r) => allowed.has(r.id));
  }, [inferredRegionId, regions]);

  const selectedRegionName = useMemo(
    () => getRegionName(regionsById, selectedPeriod?.regionId || selectedRegionId),
    [regionsById, selectedPeriod?.regionId, selectedRegionId],
  );

  const selectedRegionOutlets = useMemo(() => {
    if (selectedRegionScopeIds.length === 0) return outlets;
    const allowed = new Set(selectedRegionScopeIds);
    return outlets.filter((o) => allowed.has(o.regionId));
  }, [outlets, selectedRegionScopeIds]);

  const payrollRoster = useMemo(
    () => buildContractDrivenPayrollRoster({ users, scopes: authScopes, contracts, outletsById, selectedRegionCodes }),
    [authScopes, contracts, outletsById, selectedRegionCodes, users],
  );

  const contractsByUserId = useMemo(
    () => new Map(payrollRoster.map((e) => [e.userId, e.contract])),
    [payrollRoster],
  );

  const selectedEmployee = useMemo(
    () => payrollRoster.find((e) => e.userId === timesheetForm.userId),
    [payrollRoster, timesheetForm.userId],
  );

  const runsByTimesheetId = useMemo(
    () => new Map(runs.filter((r) => normalizeValue(r.payrollTimesheetId)).map((r) => [String(r.payrollTimesheetId), r])),
    [runs],
  );

  const availableRunTimesheets = useMemo(
    () => timesheets.filter((ts) => !runsByTimesheetId.has(String(ts.id))).sort((a, b) => normalizeValue(a.userId).localeCompare(normalizeValue(b.userId))),
    [runsByTimesheetId, timesheets],
  );

  const selectedRunSource = useMemo(
    () => timesheets.find((ts) => ts.id === runForm.payrollTimesheetId) ?? null,
    [runForm.payrollTimesheetId, timesheets],
  );

  const selectedRunContract = useMemo(
    () => (selectedRunSource?.userId ? contractsByUserId.get(String(selectedRunSource.userId)) : undefined),
    [contractsByUserId, selectedRunSource?.userId],
  );

  const timesheetRows = useMemo(
    () => timesheets.map((ts) => ({ ts, run: runsByTimesheetId.get(String(ts.id)) })).sort((a, b) => normalizeValue(a.ts.userId).localeCompare(normalizeValue(b.ts.userId))),
    [runsByTimesheetId, timesheets],
  );

  const summary = useMemo(() => ({
    rosterCount: payrollRoster.length,
    timesheetCount: timesheets.length,
    draftRuns: runs.filter((r) => normalizeValue(r.status).toLowerCase() === 'draft').length,
    approvedRuns: runs.filter((r) => normalizeValue(r.status).toLowerCase() === 'approved').length,
  }), [payrollRoster.length, runs, timesheets.length]);

  /* ---- loaders ---- */
  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const active = await hrApi.contractsActive(token);
      setContracts(active || []);
      setAuthScopes([]);
    } catch (error: unknown) {
      setDirectoryError(getErrorMessage(error, 'Unable to load roster'));
    } finally {
      setDirectoryLoading(false);
    }
  }, [token]);

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    setPeriodsError('');
    try {
      const items = await collectPagedItems<PayrollPeriodView, PayrollPeriodsQuery>(
        (q) => payrollApi.periods(token, q),
        { regionId: inferredRegionId || undefined, sortBy: 'startDate', sortDir: 'desc' },
      );
      setPeriods(items);
      setSelectedPeriodId((cur) => (cur && items.some((p) => p.id === cur)) ? cur : (items[0]?.id || ''));
    } catch (error: unknown) {
      setPeriods([]);
      setSelectedPeriodId('');
      setPeriodsError(getErrorMessage(error, 'Unable to load payroll periods'));
    } finally {
      setPeriodsLoading(false);
    }
  }, [inferredRegionId, token]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedPeriodId) { setTimesheets([]); setRuns([]); return; }
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const [tsItems, runItems] = await Promise.all([
        collectPagedItems<PayrollTimesheetView, PayrollTimesheetsQuery>(
          (q) => payrollApi.timesheets(token, q),
          { payrollPeriodId: selectedPeriodId, outletId: scopeOutletId || undefined, sortBy: 'userId', sortDir: 'asc' },
        ),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (q) => payrollApi.runs(token, q),
          { payrollPeriodId: selectedPeriodId, outletId: scopeOutletId || undefined, sortBy: 'userId', sortDir: 'asc' },
        ),
      ]);
      setTimesheets(tsItems);
      setRuns(runItems);
    } catch (error: unknown) {
      setTimesheets([]); setRuns([]);
      setWorkspaceError(getErrorMessage(error, 'Unable to load workspace'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [scopeOutletId, selectedPeriodId, token]);

  useEffect(() => { void loadDirectory(); }, [loadDirectory]);
  useEffect(() => { void loadPeriods(); }, [loadPeriods]);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (timesheetForm.userId && payrollRoster.some((e) => e.userId === timesheetForm.userId)) return;
    setTimesheetForm((cur) => ({ ...cur, userId: '' }));
  }, [payrollRoster, timesheetForm.userId]);

  useEffect(() => {
    const defaultOutletId =
      (scopeOutletId && selectedRegionOutlets.some((o) => o.id === scopeOutletId) ? scopeOutletId : '') ||
      (selectedEmployee?.preferredOutletId && selectedRegionOutlets.some((o) => o.id === selectedEmployee.preferredOutletId) ? selectedEmployee.preferredOutletId : '') ||
      '';
    setTimesheetForm((cur) => {
      if (cur.outletId && selectedRegionOutlets.some((o) => o.id === cur.outletId)) return cur;
      return { ...cur, outletId: defaultOutletId };
    });
  }, [scopeOutletId, selectedEmployee?.preferredOutletId, selectedRegionOutlets]);

  useEffect(() => {
    setRunForm((cur) => {
      if (cur.payrollTimesheetId && availableRunTimesheets.some((ts) => ts.id === cur.payrollTimesheetId)) return cur;
      return { ...cur, payrollTimesheetId: String(availableRunTimesheets[0]?.id || '') };
    });
  }, [availableRunTimesheets]);

  useEffect(() => {
    setRunForm((cur) => {
      if (!selectedRunSource?.userId) return cur;
      const nextCurrency = String(selectedRunContract?.currencyCode || cur.currencyCode || 'VND').toUpperCase();
      if (cur.currencyCode === nextCurrency) return cur;
      return { ...cur, currencyCode: nextCurrency };
    });
    setSalaryCalc(null);
  }, [selectedRunContract?.currencyCode, selectedRunSource?.userId]);

  // Auto-calculate salary when a timesheet is selected
  useEffect(() => {
    if (!runForm.payrollTimesheetId || !runForm.currencyCode) { setSalaryCalc(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const result = await payrollApi.calculateSalary(token, {
          timesheetId: runForm.payrollTimesheetId,
          currencyCode: runForm.currencyCode,
        });
        if (!cancelled) {
          setSalaryCalc(result);
          setRunForm((cur) => ({
            ...cur,
            baseSalaryAmount: result.baseSalaryAmount != null ? String(result.baseSalaryAmount) : cur.baseSalaryAmount,
            netSalary: result.netSalary != null ? String(result.netSalary) : cur.netSalary,
          }));
        }
      } catch {
        if (!cancelled) setSalaryCalc(null);
      }
    })();
    return () => { cancelled = true; };
  }, [runForm.payrollTimesheetId, runForm.currencyCode, token]);

  /* ---- actions ---- */
  const createPeriod = async () => {
    if (!periodForm.regionId || !periodForm.startDate || !periodForm.endDate) { toast.error('Region and dates are required'); return; }
    if (periodForm.endDate < periodForm.startDate) { toast.error('End date must be after start date'); return; }
    setBusyKey('create-period');
    try {
      await payrollApi.createPeriod(token, {
        regionId: periodForm.regionId,
        name: periodForm.name.trim() || `${formatMonthYear(periodForm.startDate)} ${getRegionName(regionsById, periodForm.regionId)} payroll`,
        startDate: periodForm.startDate,
        endDate: periodForm.endDate,
        payDate: periodForm.payDate || null,
        note: periodForm.note.trim() || null,
      });
      toast.success('Payroll period created');
      setPeriodDialogOpen(false);
      setPeriodForm(buildDefaultPeriodForm(periodForm.regionId));
      await loadPeriods();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create period'));
    } finally {
      setBusyKey('');
    }
  };

  const createTimesheet = async () => {
    if (!selectedPeriod) { toast.error('Choose a payroll period first'); return; }
    if (!timesheetForm.userId) { toast.error('Select an employee'); return; }
    if (!timesheetForm.outletId) { toast.error('Select an outlet'); return; }
    setBusyKey('create-timesheet');
    try {
      await payrollApi.createTimesheet(token, {
        payrollPeriodId: String(selectedPeriod.id),
        userId: timesheetForm.userId,
        outletId: timesheetForm.outletId,
        workDays: toNumber(timesheetForm.workDays),
        workHours: toNumber(timesheetForm.workHours),
        overtimeHours: toNumber(timesheetForm.overtimeHours),
        overtimeRate: toNumber(timesheetForm.overtimeRate),
        lateCount: Math.max(0, Math.trunc(toNumber(timesheetForm.lateCount))),
        absentDays: toNumber(timesheetForm.absentDays),
      });
      toast.success('Timesheet saved');
      setTimesheetForm(buildDefaultTimesheetForm(timesheetForm.outletId));
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to save timesheet'));
    } finally {
      setBusyKey('');
    }
  };

  const importFromAttendance = async () => {
    if (!selectedPeriod) { toast.error('Choose a payroll period first'); return; }
    if (!timesheetForm.userId) { toast.error('Select an employee'); return; }
    if (!timesheetForm.outletId) { toast.error('Select an outlet'); return; }
    setBusyKey('import-timesheet');
    try {
      await payrollApi.importFromAttendance(token, {
        payrollPeriodId: String(selectedPeriod.id),
        userId: timesheetForm.userId,
        outletId: timesheetForm.outletId,
        overtimeRate: toNumber(timesheetForm.overtimeRate) || 1.5,
      });
      toast.success('Timesheet imported from attendance');
      setTimesheetForm(buildDefaultTimesheetForm(timesheetForm.outletId));
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to import attendance'));
    } finally {
      setBusyKey('');
    }
  };

  const generateRun = async () => {
    if (!runForm.payrollTimesheetId) { toast.error('Select a timesheet'); return; }
    setBusyKey('generate-run');
    try {
      const base = runForm.baseSalaryAmount ? toNumber(runForm.baseSalaryAmount) : undefined;
      const net = runForm.netSalary ? toNumber(runForm.netSalary) : undefined;
      await payrollApi.generateRun(token, {
        payrollTimesheetId: runForm.payrollTimesheetId,
        currencyCode: runForm.currencyCode,
        baseSalaryAmount: base && base > 0 ? base : null,
        netSalary: net && net > 0 ? net : null,
        note: runForm.note.trim() || null,
      });
      toast.success('Draft run created');
      setRunForm(buildDefaultRunForm());
      setSalaryCalc(null);
      await loadWorkspace();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to generate run'));
    } finally {
      setBusyKey('');
    }
  };

  const bulkGenerateAll = async () => {
    if (availableRunTimesheets.length === 0) { toast.success('All timesheets already have runs'); return; }
    setBulkProgress({ total: availableRunTimesheets.length, done: 0, failed: 0 });
    let done = 0; let failed = 0;
    for (const ts of availableRunTimesheets) {
      const contract = contractsByUserId.get(String(ts.userId));
      const currency = String(contract?.currencyCode || 'VND').toUpperCase();
      try {
        await payrollApi.generateRun(token, {
          payrollTimesheetId: String(ts.id),
          currencyCode: currency,
          baseSalaryAmount: null,
          netSalary: null,
          note: null,
        });
        done += 1;
      } catch { failed += 1; }
      setBulkProgress({ total: availableRunTimesheets.length, done: done + failed, failed });
    }
    setBulkProgress(null);
    if (done > 0) toast.success(`${done} draft run(s) generated`);
    if (failed > 0) toast.error(`${failed} failed — employees may be missing active contracts`);
    await loadWorkspace();
  };

  const bulkImportAll = async () => {
    if (!selectedPeriodId || payrollRoster.length === 0) return;
    const toImport = payrollRoster.filter((e) => !timesheets.some((ts) => normalizeValue(ts.userId) === e.userId));
    if (toImport.length === 0) { toast.success('All employees already have timesheets'); setPrepStep(2); return; }
    setBulkProgress({ total: toImport.length, done: 0, failed: 0 });
    let done = 0; let failed = 0;
    for (const entry of toImport) {
      try {
        await payrollApi.importFromAttendance(token, {
          payrollPeriodId: selectedPeriodId,
          userId: entry.userId,
          outletId: entry.preferredOutletId || undefined,
          overtimeRate: 1.5,
        });
        done += 1;
      } catch { failed += 1; }
      setBulkProgress({ total: toImport.length, done: done + failed, failed });
    }
    setBulkProgress(null);
    if (done > 0) toast.success(`${done} timesheet(s) imported`);
    if (failed > 0) toast.error(`${failed} failed`);
    await loadWorkspace();
    setPrepStep(2);
  };

  /* ================================================================== */
  /*  RENDER                                                              */
  /* ================================================================== */

  const STEPS = [
    { step: 1 as const, label: 'Import Attendance', icon: Clock },
    { step: 2 as const, label: 'Review Timesheets', icon: FileText },
    { step: 3 as const, label: 'Generate Runs', icon: Sparkles },
  ];

  return (
    <>
      <div className="grid h-full xl:grid-cols-[260px_minmax(0,1fr)]">
        {/* ── Sidebar: period list ── */}
        <aside className="surface-elevated flex flex-col overflow-hidden border-r">
          <div className="border-b px-4 py-4">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Payroll Windows</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setPeriodDialogOpen(true)}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                New period
              </button>
              <button
                onClick={() => { void loadDirectory(); void loadPeriods(); void loadWorkspace(); }}
                disabled={directoryLoading || periodsLoading || workspaceLoading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', (directoryLoading || periodsLoading || workspaceLoading) && 'animate-spin')} />
              </button>
            </div>
          </div>

          {periodsError ? <p className="border-b px-4 py-2 text-xs text-destructive">{periodsError}</p> : null}

          <div className="flex-1 overflow-y-auto">
            {periodsLoading && periods.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</p>
            ) : periods.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No payroll windows yet</p>
            ) : periods.map((period) => {
              const state = inferPeriodWindowState(period);
              const active = period.id === selectedPeriodId;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => setSelectedPeriodId(period.id)}
                  className={cn(
                    'w-full border-b px-4 py-3.5 text-left transition-colors hover:bg-accent/30',
                    active ? 'bg-primary/5 border-l-2 border-l-primary' : '',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold leading-snug">
                        {buildPeriodHeadline(period, getRegionName(regionsById, period.regionId))}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateRange(period.startDate, period.endDate)}</p>
                      {period.payDate ? <p className="mt-0.5 text-[10px] text-muted-foreground">Pay {formatDate(period.payDate)}</p> : null}
                    </div>
                    <span className={cn('mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium', periodWindowBadgeClass(state))}>
                      {periodWindowLabel(state)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Main content ── */}
        <section className="flex flex-col overflow-hidden">
          {!selectedPeriod ? (
            <div className="flex flex-1 items-center justify-center px-8 py-16">
              <EmptyState
                title="Select a payroll window"
                description="Choose a period from the left panel to begin preparing payroll."
              />
            </div>
          ) : (
            <>
              {/* Period header */}
              <div className="border-b px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', periodWindowBadgeClass(inferPeriodWindowState(selectedPeriod)))}>
                        {periodWindowLabel(inferPeriodWindowState(selectedPeriod))}
                      </span>
                      <span className="text-xs text-muted-foreground">{selectedRegionName}</span>
                      <span className="text-xs text-muted-foreground">{formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate)}</span>
                    </div>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">
                      {buildPeriodHeadline(selectedPeriod, selectedRegionName)}
                    </h2>
                  </div>
                  {/* Summary chips */}
                  <div className="flex flex-wrap gap-3">
                    {[
                      { label: 'Rostered', value: summary.rosterCount },
                      { label: 'Timesheets', value: summary.timesheetCount },
                      { label: 'Draft runs', value: summary.draftRuns },
                      { label: 'Approved', value: summary.approvedRuns },
                    ].map((chip) => (
                      <div key={chip.label} className="rounded-lg border bg-background px-3 py-1.5 text-center">
                        <p className="text-base font-semibold leading-tight">{chip.value}</p>
                        <p className="text-[10px] text-muted-foreground">{chip.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {directoryError ? <p className="mt-2 text-xs text-destructive">{directoryError}</p> : null}
                {workspaceError ? <p className="mt-2 text-xs text-destructive">{workspaceError}</p> : null}
              </div>

              {/* Step bar */}
              <div className="flex items-center gap-0 border-b bg-muted/20 px-6 py-0">
                {STEPS.map((s, i) => {
                  const done = prepStep > s.step;
                  const active = prepStep === s.step;
                  return (
                    <button
                      key={s.step}
                      onClick={() => setPrepStep(s.step)}
                      className={cn(
                        'flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition-colors',
                        active ? 'border-primary text-primary' : done ? 'border-transparent text-emerald-600' : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', active ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground')}>
                          {s.step}
                        </span>
                      )}
                      {s.label}
                      {i < STEPS.length - 1 ? <span className="ml-4 text-muted-foreground/30">›</span> : null}
                    </button>
                  );
                })}
              </div>

              {/* ── STEP 1: Import Attendance ── */}
              {prepStep === 1 ? (
                <div className="flex-1 overflow-y-auto">
                  <div className="px-6 py-5 space-y-4">
                    {/* Action bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Import attendance data</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {timesheets.length > 0
                            ? `${timesheets.length} of ${payrollRoster.length} employees have timesheets`
                            : `${payrollRoster.length} employees in this period`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void bulkImportAll()}
                          disabled={!!bulkProgress || payrollRoster.length === 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          {bulkProgress ? `Importing ${bulkProgress.done}/${bulkProgress.total}…` : 'Import All from Attendance'}
                        </button>
                        <button
                          onClick={() => setPrepStep(2)}
                          className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent"
                        >
                          Enter manually
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {bulkProgress ? (
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {bulkProgress.done}/{bulkProgress.total} processed
                          {bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ''}
                        </p>
                      </div>
                    ) : null}

                    {/* Roster table */}
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Employee</th>
                            <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Code</th>
                            <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Outlet</th>
                            <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Contract type</th>
                            <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Timesheet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payrollRoster.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees in roster for this period</td></tr>
                          ) : payrollRoster.map((entry) => {
                            const has = timesheets.some((ts) => normalizeValue(ts.userId) === entry.userId);
                            return (
                              <tr key={entry.userId} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-2.5 text-sm font-medium">{entry.fullName}</td>
                                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{entry.employeeCode || '—'}</td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.outletLabels[0] || '—'}</td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatHrEnumLabel(entry.contract.employmentType)}</td>
                                <td className="px-4 py-2.5">
                                  {has ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                                      <CheckCircle2 className="h-3 w-3" /> Imported
                                    </span>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border">
                                      Pending
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => setPrepStep(2)}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Next: Review Timesheets →
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── STEP 2: Review Timesheets ── */}
              {prepStep === 2 ? (
                <Step2ReviewTimesheets
                  timesheetRows={timesheetRows}
                  payrollRoster={payrollRoster}
                  timesheets={timesheets}
                  workspaceLoading={workspaceLoading}
                  busyKey={busyKey}
                  selectedPeriod={selectedPeriod}
                  timesheetForm={timesheetForm}
                  setTimesheetForm={setTimesheetForm}
                  selectedEmployee={selectedEmployee}
                  selectedRegionOutlets={selectedRegionOutlets}
                  usersById={usersById}
                  outletsById={outletsById}
                  summary={summary}
                  createTimesheet={createTimesheet}
                  importFromAttendance={importFromAttendance}
                  onNext={() => setPrepStep(3)}
                />
              ) : null}

              {/* ── STEP 3: Generate Runs ── */}
              {prepStep === 3 ? (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid xl:grid-cols-[380px_minmax(0,1fr)] h-full divide-x">
                    {/* Left: generate run form */}
                    <div className="px-5 py-5 space-y-4 overflow-y-auto">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Generate draft run</h3>
                        <button
                          onClick={() => void bulkGenerateAll()}
                          disabled={!!bulkProgress || availableRunTimesheets.length === 0}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          <Sparkles className="h-3 w-3" />
                          {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}…` : `Generate All (${availableRunTimesheets.length})`}
                        </button>
                      </div>

                      {bulkProgress ? (
                        <div className="space-y-1">
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {bulkProgress.done}/{bulkProgress.total} processed{bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ''}
                          </p>
                        </div>
                      ) : null}

                      <Field label="Timesheet (no run yet)">
                        <select
                          value={runForm.payrollTimesheetId}
                          onChange={(e) => setRunForm((c) => ({ ...c, payrollTimesheetId: e.target.value }))}
                          className={inputCls}
                        >
                          <option value="">Select timesheet</option>
                          {availableRunTimesheets.map((ts) => {
                            const user = getHrUserDisplay(usersById, ts.userId);
                            return (
                              <option key={ts.id} value={ts.id}>
                                {user.primary} · {toNumber(ts.workHours).toFixed(1)} hrs
                              </option>
                            );
                          })}
                        </select>
                      </Field>

                      {selectedRunSource ? (
                        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs space-y-1">
                          <p className="font-medium">{getHrUserDisplay(usersById, selectedRunSource.userId).primary}</p>
                          <p className="text-muted-foreground">
                            {getHrOutletDisplay(outletsById, selectedRunSource.outletId).primary}
                          </p>
                          <div className="flex gap-3 text-muted-foreground">
                            <span>{toNumber(selectedRunSource.workDays)} days</span>
                            <span>{toNumber(selectedRunSource.workHours).toFixed(1)} hrs</span>
                            <span>{toNumber(selectedRunSource.overtimeHours).toFixed(1)} OT hrs</span>
                          </div>
                        </div>
                      ) : null}

                      {/* Salary calculation breakdown */}
                      {salaryCalc ? (
                        <div className="rounded-lg border bg-background p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Auto-calculated</span>
                            <span className="text-[10px] text-muted-foreground capitalize">
                              {formatHrEnumLabel(salaryCalc.employmentType)} · {formatHrEnumLabel(salaryCalc.salaryType)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Base pay</span>
                            <span className="font-mono">{formatCurrency(salaryCalc.breakdown?.basePay, salaryCalc.currencyCode || 'VND')}</span>
                          </div>
                          {toNumber(salaryCalc.breakdown?.overtimePay) > 0 ? (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">
                                Overtime ({toNumber(salaryCalc.breakdown?.overtimeHours).toFixed(1)}h × {toNumber(salaryCalc.breakdown?.overtimeRate)}×)
                              </span>
                              <span className="font-mono text-emerald-600">+{formatCurrency(salaryCalc.breakdown?.overtimePay, salaryCalc.currencyCode || 'VND')}</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between text-sm font-semibold border-t pt-1.5">
                            <span>Net salary</span>
                            <span className="font-mono">{formatCurrency(salaryCalc.netSalary, salaryCalc.currencyCode || 'VND')}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {salaryCalc.breakdown?.calculationMethod === 'monthly_with_overtime'
                              ? 'Full monthly salary + overtime premium'
                              : salaryCalc.breakdown?.calculationMethod === 'daily'
                                ? 'Work days × daily rate'
                                : 'Work hours × hourly rate'}
                          </p>
                        </div>
                      ) : selectedRunSource ? (
                        <p className="text-[11px] text-muted-foreground">Calculating salary…</p>
                      ) : null}

                      <Field label="Currency">
                        <input
                          value={runForm.currencyCode}
                          onChange={(e) => setRunForm((c) => ({ ...c, currencyCode: e.target.value.toUpperCase() }))}
                          className={inputCls}
                        />
                      </Field>

                      {/* Manual override section — collapsed by default */}
                      <details className="group">
                        <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                          Override salary manually
                        </summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <Field label="Base salary">
                            <input
                              type="number"
                              value={runForm.baseSalaryAmount}
                              onChange={(e) => setRunForm((c) => ({ ...c, baseSalaryAmount: e.target.value }))}
                              placeholder="Auto from contract"
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Net salary">
                            <input
                              type="number"
                              value={runForm.netSalary}
                              onChange={(e) => setRunForm((c) => ({ ...c, netSalary: e.target.value }))}
                              placeholder="Auto calculated"
                              className={inputCls}
                            />
                          </Field>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">Leave empty to auto-calculate from contract.</p>
                      </details>

                      <Field label="Note (optional)">
                        <textarea
                          value={runForm.note}
                          onChange={(e) => setRunForm((c) => ({ ...c, note: e.target.value }))}
                          rows={2}
                          placeholder="Note for Finance"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </Field>

                      <button
                        onClick={() => void generateRun()}
                        disabled={busyKey === 'generate-run' || !selectedPeriod || !runForm.payrollTimesheetId}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {busyKey === 'generate-run' ? 'Generating…' : 'Generate Draft Run'}
                      </button>
                    </div>

                    {/* Right: runs list */}
                    <div className="flex flex-col overflow-hidden">
                      <div className="border-b px-5 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">Payroll runs ({runs.length})</p>
                          <p className="text-[11px] text-muted-foreground">{summary.draftRuns} draft · {summary.approvedRuns} approved</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{availableRunTimesheets.length} pending</span>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        <table className="w-full">
                          <thead className="sticky top-0 z-10">
                            <tr className="border-b bg-background">
                              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Employee</th>
                              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Outlet</th>
                              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Type</th>
                              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Status</th>
                              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Base</th>
                              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground">Net salary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workspaceLoading && runs.length === 0 ? (
                              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>
                            ) : runs.length === 0 ? (
                              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No runs yet</td></tr>
                            ) : runs.map((run) => {
                              const runContract = contractsByUserId.get(String(run.userId));
                              return (
                                <tr key={run.id} className="border-b last:border-0 hover:bg-muted/20">
                                  <td className="px-4 py-2.5">
                                    <p className="text-xs font-medium">{getHrUserDisplay(usersById, run.userId).primary}</p>
                                    <p className="text-[10px] text-muted-foreground">{shortHrRef(run.id)}</p>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{getHrOutletDisplay(outletsById, run.outletId).primary}</td>
                                  <td className="px-4 py-2.5 text-[10px] text-muted-foreground capitalize">{formatHrEnumLabel(runContract?.employmentType)}</td>
                                  <td className="px-4 py-2.5">
                                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', payrollBadgeClass(run.status))}>
                                      {formatHrEnumLabel(run.status)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                                    {formatCurrency(run.baseSalaryAmount, String(run.currencyCode || 'VND'))}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">
                                    {formatCurrency(run.netSalary, String(run.currencyCode || 'VND'))}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {/* Runs summary footer */}
                      {runs.length > 0 ? (
                        <div className="border-t px-5 py-2.5 flex items-center justify-between bg-background">
                          <span className="text-[11px] text-muted-foreground">{runs.length} run(s)</span>
                          <span className="text-sm font-mono font-semibold">
                            Total: {formatCurrency(runs.reduce((s, r) => s + toNumber(r.netSalary), 0), runs[0]?.currencyCode || 'VND')}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {/* ── Create Period Dialog ── */}
      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New payroll period</DialogTitle>
            <DialogDescription>
              Define the payroll window for a region. Timesheets and runs will be scoped to this period.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field label="Region">
              <select
                value={periodForm.regionId}
                onChange={(e) => setPeriodForm((c) => ({ ...c, regionId: e.target.value }))}
                className={inputCls}
              >
                <option value="">Select region</option>
                {availablePeriodRegions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Name (optional)">
              <input
                value={periodForm.name}
                onChange={(e) => setPeriodForm((c) => ({ ...c, name: e.target.value }))}
                className={inputCls}
                placeholder={`${formatMonthYear(periodForm.startDate)} ${getRegionName(regionsById, periodForm.regionId || inferredRegionId)} payroll`}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Start date">
                <input type="date" value={periodForm.startDate} onChange={(e) => setPeriodForm((c) => ({ ...c, startDate: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="End date">
                <input type="date" value={periodForm.endDate} onChange={(e) => setPeriodForm((c) => ({ ...c, endDate: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Pay date">
                <input type="date" value={periodForm.payDate} onChange={(e) => setPeriodForm((c) => ({ ...c, payDate: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Note">
              <textarea
                value={periodForm.note}
                onChange={(e) => setPeriodForm((c) => ({ ...c, note: e.target.value }))}
                rows={2}
                placeholder="Optional note"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setPeriodDialogOpen(false)}
              className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createPeriod()}
              disabled={busyKey === 'create-period'}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {busyKey === 'create-period' ? 'Creating…' : 'Create period'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
