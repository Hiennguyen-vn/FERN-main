import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayLocalISO } from '@/lib/date-format';
import {
  Search, User, FileText, DollarSign, Clock,
  Eye, X, Phone, Mail, MapPin, Calendar, Briefcase, CreditCard,
  Users, UserPlus, UserMinus, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  hrApi,
  payrollApi,
  type AuthUserListItem,
  type HrEmployeeView,
  type ContractView,
  type ContractsQuery,
  type ScopeOutlet,
  type ScopeRegion,
  type PayrollRunView,
  type PayrollRunsQuery,
} from '@/api/fern-api';
import { collectPagedItems } from '@/lib/collect-paged-items';
import {
  contractBadgeClass,
  payrollBadgeClass,
  formatHrEnumLabel,
  shortHrRef,
} from '@/components/hr/hr-display';
import { ContractTimeline } from '@/components/hr/ContractTimeline';
import {
  ExceptionBanner,
  FilterBar,
  KpiCard,
  KpiStrip,
  SegmentChip,
  SegmentChipRow,
  SeverityPill,
  WorkspaceHeader,
  getInitials,
} from '@/components/hr/hr-primitives';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface EmployeeProfileWorkspaceProps {
  token: string;
  users: AuthUserListItem[];
  hrEmployees: HrEmployeeView[];
  usersError?: string;
  outlets: ScopeOutlet[];
  regions: ScopeRegion[];
  scopeOutletId?: string;
}

/* ------------------------------------------------------------------ */
/*  Sub-components: Employee Detail Modal                              */
/* ------------------------------------------------------------------ */

function EmployeeDetailSheet({ employee, open, onClose }: {
  employee: HrEmployeeView | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!employee) return null;
  const rows: Array<{ icon: React.ElementType; label: string; value: string | null | undefined }> = [
    { icon: User, label: 'Full Name', value: employee.fullName },
    { icon: User, label: 'Username', value: employee.username },
    { icon: Briefcase, label: 'Employee Code', value: employee.employeeCode },
    { icon: Mail, label: 'Email', value: employee.email },
    { icon: Phone, label: 'Phone', value: employee.phone },
    { icon: Calendar, label: 'Date of Birth', value: formatDate(employee.dob) },
    { icon: User, label: 'Gender', value: employee.gender ? formatHrEnumLabel(employee.gender) : null },
    { icon: User, label: 'Status', value: employee.status ? formatHrEnumLabel(employee.status) : null },
    { icon: Calendar, label: 'Joined', value: formatDate(employee.createdAt) },
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Employee Profile</DialogTitle>
          <DialogDescription>{employee.fullName} — {employee.employeeCode || employee.username}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-1">
          {/* Avatar area */}
          <div className="flex justify-center mb-4">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
              <User className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          {rows.map((row) => {
            const val = row.value;
            if (!val || val === '—') return null;
            const Icon = row.icon;
            return (
              <div key={row.label} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{row.label}</p>
                  <p className="text-sm font-medium">{val}</p>
                </div>
              </div>
            );
          })}

          {/* Active contract summary */}
          {employee.activeContract ? (
            <div className="mt-4 surface-elevated p-4 rounded-md space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Active Contract</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Type</span><p className="font-medium">{formatHrEnumLabel(employee.activeContract.employmentType)}</p></div>
                <div><span className="text-muted-foreground">Salary Type</span><p className="font-medium">{formatHrEnumLabel(employee.activeContract.salaryType)}</p></div>
                <div><span className="text-muted-foreground">Base Salary</span><p className="font-medium">{formatCurrency(employee.activeContract.baseSalary, String(employee.activeContract.currencyCode || 'USD'))}</p></div>
                <div><span className="text-muted-foreground">Region</span><p className="font-medium">{employee.activeContract.regionCode || '—'}</p></div>
                <div><span className="text-muted-foreground">Start</span><p className="font-medium">{formatDate(employee.activeContract.startDate)}</p></div>
                <div><span className="text-muted-foreground">End</span><p className="font-medium">{formatDate(employee.activeContract.endDate)}</p></div>
              </div>
            </div>
          ) : (
            <div className="mt-4 p-3 rounded-md bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-800">No active contract</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components: Contract Detail Sheet                              */
/* ------------------------------------------------------------------ */

function ContractDetailPopup({ contract, open, onClose }: {
  contract: ContractView | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!contract) return null;
  const status = String(contract.status || 'unknown').toLowerCase();

  const sections: Array<{ title: string; icon: React.ElementType; items: Array<{ label: string; value: string }> }> = [
    {
      title: 'Employment Terms',
      icon: Briefcase,
      items: [
        { label: 'Employment Type', value: formatHrEnumLabel(contract.employmentType) },
        { label: 'Salary Type', value: formatHrEnumLabel(contract.salaryType) },
        { label: 'Base Salary', value: formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD')) },
        { label: 'Currency', value: String(contract.currencyCode || '—').toUpperCase() },
      ],
    },
    {
      title: 'Contract Period',
      icon: Calendar,
      items: [
        { label: 'Start Date', value: formatDate(contract.startDate) },
        { label: 'End Date', value: formatDate(contract.endDate) },
        { label: 'Hire Date', value: formatDate(contract.hireDate) },
      ],
    },
    {
      title: 'Payment Details',
      icon: CreditCard,
      items: [
        { label: 'Tax Code', value: String(contract.taxCode || '—') },
        { label: 'Bank Account', value: String(contract.bankAccount || '—') },
      ],
    },
    {
      title: 'Region & Metadata',
      icon: MapPin,
      items: [
        { label: 'Region', value: String(contract.regionCode || '—') },
        { label: 'Created', value: formatDate(contract.createdAt) },
        { label: 'Updated', value: formatDate(contract.updatedAt) },
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">Contract Details</SheetTitle>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
              {formatHrEnumLabel(status)}
            </span>
          </div>
          <SheetDescription>{shortHrRef(contract.id)}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <div key={section.title} className="surface-elevated p-4 space-y-1">
                <div className="flex items-center gap-1.5 mb-3">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{section.title}</span>
                </div>
                {section.items.map((item) => (
                  <div key={item.label} className="flex justify-between py-1.5">
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                    <span className="text-sm font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Expiry warning */}
          {contract.endDate && status === 'active' ? (() => {
            const daysLeft = Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000);
            if (daysLeft <= 0) return <p className="text-xs text-destructive font-medium p-3 bg-destructive/10 rounded-md">Contract has expired</p>;
            if (daysLeft <= 30) return <p className="text-xs text-amber-700 font-medium p-3 bg-amber-50 rounded-md">Expires in {daysLeft} days</p>;
            return <p className="text-xs text-muted-foreground p-3 bg-muted/30 rounded-md">{daysLeft} days remaining</p>;
          })() : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function EmployeeProfileWorkspace({
  token,
  hrEmployees,
  usersError,
  scopeOutletId,
}: EmployeeProfileWorkspaceProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [contractFilter, setContractFilter] = useState<'all' | 'active' | 'none'>('all');
  const [segment, setSegment] = useState<'all' | 'active' | 'no_contract' | 'inactive'>('all');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Data for selected employee
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunView[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<{ present: number; late: number; absent: number; total: number }>({ present: 0, late: 0, absent: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  // Sheet states
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [selectedContractDetail, setSelectedContractDetail] = useState<ContractView | null>(null);

  const hrEmployeesById = useMemo(() => new Map(hrEmployees.map((e) => [e.id, e])), [hrEmployees]);

  const filteredEmployees = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    return hrEmployees.filter((e) => {
      if (lower) {
        const match =
          (e.fullName || '').toLowerCase().includes(lower) ||
          (e.username || '').toLowerCase().includes(lower) ||
          (e.employeeCode || '').toLowerCase().includes(lower) ||
          (e.email || '').toLowerCase().includes(lower);
        if (!match) return false;
      }
      if (contractFilter === 'active' && !e.activeContract) return false;
      if (contractFilter === 'none' && e.activeContract) return false;
      const status = String(e.status || '').toLowerCase();
      switch (segment) {
        case 'active': return status === 'active' && Boolean(e.activeContract);
        case 'no_contract': return !e.activeContract;
        case 'inactive': return status !== 'active' && status !== '';
        default: return true;
      }
    });
  }, [hrEmployees, searchTerm, contractFilter, segment]);

  const employeeCounts = useMemo(() => {
    let active = 0;
    let noContract = 0;
    let inactive = 0;
    let newThisMonth = 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (const e of hrEmployees) {
      const status = String(e.status || '').toLowerCase();
      if (status === 'active' && e.activeContract) active++;
      if (!e.activeContract) noContract++;
      if (status && status !== 'active') inactive++;
      if (e.createdAt) {
        const created = new Date(e.createdAt);
        if (Number.isFinite(created.getTime()) && created >= monthStart) newThisMonth++;
      }
    }
    return { all: hrEmployees.length, active, noContract, inactive, newThisMonth };
  }, [hrEmployees]);

  const loadEmployeeData = useCallback(async (userId: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const [contractsResult, runsResult, attendanceResult] = await Promise.allSettled([
        collectPagedItems<ContractView, ContractsQuery>(
          (q) => hrApi.contractsPaged(token, q),
          { userId, outletId: scopeOutletId || undefined, sortBy: 'startDate', sortDir: 'desc' },
          50,
        ),
        collectPagedItems<PayrollRunView, PayrollRunsQuery>(
          (q) => payrollApi.runs(token, q),
          { userId, outletId: scopeOutletId || undefined, sortBy: 'createdAt', sortDir: 'desc' },
          50,
        ),
        hrApi.workShiftsPaged(token, {
          userId,
          outletId: scopeOutletId || undefined,
          startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          endDate: todayLocalISO(),
          limit: 200,
          offset: 0,
        }),
      ]);

      if (contractsResult.status === 'fulfilled') setContracts(contractsResult.value);
      else setContracts([]);

      if (runsResult.status === 'fulfilled') setPayrollRuns(runsResult.value);
      else setPayrollRuns([]);

      if (attendanceResult.status === 'fulfilled') {
        const shifts = attendanceResult.value.items || [];
        setAttendanceSummary({
          present: shifts.filter((s) => String(s.attendanceStatus || '').toLowerCase() === 'present').length,
          late: shifts.filter((s) => String(s.attendanceStatus || '').toLowerCase() === 'late').length,
          absent: shifts.filter((s) => String(s.attendanceStatus || '').toLowerCase() === 'absent').length,
          total: shifts.length,
        });
      } else {
        setAttendanceSummary({ present: 0, late: 0, absent: 0, total: 0 });
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [scopeOutletId, token]);

  useEffect(() => {
    if (!selectedUserId) {
      return;
    }
    if (hrEmployeesById.has(selectedUserId)) {
      return;
    }
    setSelectedUserId(null);
  }, [hrEmployeesById, selectedUserId]);

  useEffect(() => {
    if (selectedUserId) void loadEmployeeData(selectedUserId);
  }, [selectedUserId, loadEmployeeData]);

  const selectedEmployee = selectedUserId ? hrEmployeesById.get(selectedUserId) : null;
  const activeContract = contracts.find((c) => String(c.status || '').toLowerCase() === 'active');

  const openDrawer = (userId: string) => {
    setSelectedUserId(userId);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        title="Employees"
        subtitle="Roster, contracts, payroll, and attendance per employee."
      />

      {usersError ? (
        <ExceptionBanner tone="warn" icon={AlertTriangle} message={<span>{usersError}</span>} />
      ) : null}

      {employeeCounts.noContract > 0 ? (
        <ExceptionBanner
          tone="warn"
          icon={AlertTriangle}
          message={
            <>
              <span className="font-medium">{employeeCounts.noContract} employee{employeeCounts.noContract === 1 ? '' : 's'}</span> without an active contract.
            </>
          }
          action={
            <button
              type="button"
              onClick={() => setSegment('no_contract')}
              className="inline-flex h-7 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              Review
            </button>
          }
        />
      ) : null}

      <KpiStrip cols={4}>
        <KpiCard icon={Users} label="Headcount" value={employeeCounts.all} />
        <KpiCard icon={UserPlus} label="Active" value={employeeCounts.active} tone="success" />
        <KpiCard icon={UserMinus} label="No contract" value={employeeCounts.noContract} tone={employeeCounts.noContract > 0 ? 'warn' : 'default'} />
        <KpiCard icon={Calendar} label="New this month" value={employeeCounts.newThisMonth} />
      </KpiStrip>

      <FilterBar>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
            placeholder="Search by name, code, email"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={contractFilter}
          onChange={(e) => setContractFilter(e.target.value as 'all' | 'active' | 'none')}
        >
          <option value="all">All contracts</option>
          <option value="active">Active contract</option>
          <option value="none">No contract</option>
        </select>
      </FilterBar>

      <SegmentChipRow>
        <SegmentChip label="All" count={employeeCounts.all} active={segment === 'all'} onClick={() => setSegment('all')} />
        <SegmentChip label="Active" count={employeeCounts.active} active={segment === 'active'} tone="success" onClick={() => setSegment('active')} />
        <SegmentChip label="No contract" count={employeeCounts.noContract} active={segment === 'no_contract'} tone="warn" onClick={() => setSegment('no_contract')} />
        <SegmentChip label="Inactive" count={employeeCounts.inactive} active={segment === 'inactive'} onClick={() => setSegment('inactive')} />
      </SegmentChipRow>

      {/* Roster list */}
      {filteredEmployees.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <User className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">No employees match this view</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a different segment or clear filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60 bg-card">
          <div className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span></span>
            <span>Name</span>
            <span className="hidden sm:block">Active contract</span>
            <span className="hidden md:block">Email / phone</span>
            <span>Status</span>
            <span></span>
          </div>
          {filteredEmployees.map((emp) => {
            const status = String(emp.status || '').toLowerCase();
            const tone = status === 'active' && emp.activeContract ? 'active' : (!emp.activeContract ? 'expiring' : 'neutral');
            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => openDrawer(emp.id)}
                className="grid w-full grid-cols-[40px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/40"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
                  <span className="text-xs font-semibold tracking-tight text-primary">{getInitials(emp.fullName || emp.username)}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{emp.fullName || emp.username}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{emp.employeeCode || emp.username}</p>
                </div>
                <div className="hidden min-w-0 sm:block">
                  {emp.activeContract ? (
                    <p className="truncate text-xs text-foreground">
                      {formatHrEnumLabel(emp.activeContract.employmentType)} · {formatHrEnumLabel(emp.activeContract.salaryType)}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-400">No active contract</p>
                  )}
                  {emp.activeContract ? (
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {formatCurrency(emp.activeContract.baseSalary, String(emp.activeContract.currencyCode || 'USD'))}
                    </p>
                  ) : null}
                </div>
                <div className="hidden min-w-0 md:block">
                  {emp.email ? <p className="truncate text-xs text-muted-foreground">{emp.email}</p> : null}
                  {emp.phone ? <p className="truncate font-mono text-[10px] text-muted-foreground">{emp.phone}</p> : null}
                </div>
                <SeverityPill tone={tone}>
                  {emp.status ? formatHrEnumLabel(emp.status) : 'Unknown'}
                </SeverityPill>
                <Eye className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}

      {/* Employee detail drawer */}
      <Sheet open={drawerOpen} onOpenChange={(v) => { if (!v) { setDrawerOpen(false); setSelectedUserId(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
          {selectedEmployee ? (
            <>
              <SheetHeader className="border-b border-border/60 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
                    <span className="text-sm font-semibold tracking-tight text-primary">{getInitials(selectedEmployee.fullName || selectedEmployee.username)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-base">{selectedEmployee.fullName || selectedEmployee.username}</SheetTitle>
                    <SheetDescription className="font-mono text-[11px]">
                      {selectedEmployee.employeeCode || selectedEmployee.username}
                      {selectedEmployee.email ? ` · ${selectedEmployee.email}` : ''}
                    </SheetDescription>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProfileSheetOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <Eye className="h-3.5 w-3.5" /> Full profile
                  </button>
                </div>
              </SheetHeader>

              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                {loading ? (
                  <ListTableSkeleton columns={4} rows={3} />
                ) : (
                  <>
                    {/* Quick KPI */}
                    <KpiStrip cols={4}>
                      <KpiCard icon={FileText} label="Contracts" value={contracts.length} sub={activeContract ? formatHrEnumLabel(activeContract.employmentType) : 'none active'} tone={activeContract ? 'success' : 'warn'} />
                      <KpiCard icon={DollarSign} label="Payroll runs" value={payrollRuns.length} />
                      <KpiCard icon={Clock} label="Attendance 30d" value={attendanceSummary.total} sub={`${attendanceSummary.present} present`} />
                      <KpiCard
                        icon={DollarSign}
                        label="Current salary"
                        value={activeContract ? formatCurrency(activeContract.baseSalary, String(activeContract.currencyCode || 'USD')) : '—'}
                        sub={activeContract ? formatHrEnumLabel(activeContract.salaryType) : undefined}
                        tone={activeContract ? 'default' : 'warn'}
                      />
                    </KpiStrip>

                    {/* Contracts */}
                    {contracts.length > 0 ? (
                      <section className="rounded-md border border-border/60 bg-card">
                        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Contract history</span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{contracts.length}</span>
                        </div>
                        <div className="px-4 py-3">
                          <ContractTimeline contracts={contracts} />
                        </div>
                        <div className="border-t border-border/60">
                          {contracts.map((c, idx) => {
                            const cStatus = String(c.status || 'unknown').toLowerCase();
                            return (
                              <button
                                key={String(c.id)}
                                type="button"
                                onClick={() => setSelectedContractDetail(c)}
                                className={cn(
                                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-accent/40',
                                  idx > 0 ? 'border-t border-border/40' : '',
                                )}
                              >
                                <span className="font-mono text-[10px] text-muted-foreground">#{shortHrRef(c.id)}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-foreground">{formatHrEnumLabel(c.employmentType)} · {formatHrEnumLabel(c.salaryType)}</p>
                                  <p className="truncate font-mono text-[10px] text-muted-foreground">{formatDate(c.startDate)} — {formatDate(c.endDate)}</p>
                                </div>
                                <span className="font-mono text-xs tabular-nums text-foreground">{formatCurrency(c.baseSalary, String(c.currencyCode || 'USD'))}</span>
                                <SeverityPill tone={cStatus === 'active' ? 'active' : cStatus === 'terminated' ? 'locked' : cStatus === 'expired' ? 'expired' : 'neutral'}>
                                  {formatHrEnumLabel(cStatus)}
                                </SeverityPill>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ) : null}

                    {/* Payroll history */}
                    {payrollRuns.length > 0 ? (
                      <section className="rounded-md border border-border/60 bg-card">
                        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Payroll history</span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{payrollRuns.length}</span>
                        </div>
                        <div>
                          {payrollRuns.slice(0, 10).map((run, idx) => {
                            const rStatus = String(run.status || 'unknown').toLowerCase();
                            return (
                              <div key={String(run.id)} className={cn('flex items-center gap-3 px-4 py-2.5 text-xs', idx > 0 ? 'border-t border-border/40' : '')}>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-foreground">{run.payrollPeriodName || shortHrRef(run.id)}</p>
                                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                                    Base {formatCurrency(run.baseSalaryAmount, String(run.currencyCode || 'USD'))}
                                    {run.approvedAt ? ` · Approved ${formatDate(run.approvedAt)}` : ''}
                                  </p>
                                </div>
                                <span className="font-mono text-sm tabular-nums font-semibold text-foreground">
                                  {formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}
                                </span>
                                <SeverityPill tone={rStatus === 'paid' || rStatus === 'approved' ? 'active' : rStatus === 'draft' ? 'draft' : rStatus === 'failed' ? 'expired' : 'neutral'}>
                                  {formatHrEnumLabel(rStatus)}
                                </SeverityPill>
                              </div>
                            );
                          })}
                          {payrollRuns.length > 10 ? (
                            <p className="border-t border-border/40 px-4 py-2 font-mono text-[10px] text-muted-foreground">+{payrollRuns.length - 10} more runs</p>
                          ) : null}
                        </div>
                      </section>
                    ) : null}

                    {/* Attendance */}
                    {attendanceSummary.total > 0 ? (
                      <section className="rounded-md border border-border/60 bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Attendance · last 30 days</span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{attendanceSummary.total} shifts</span>
                        </div>
                        <KpiStrip cols={3}>
                          <KpiCard icon={Clock} label="Present" value={attendanceSummary.present} tone="success" />
                          <KpiCard icon={Clock} label="Late" value={attendanceSummary.late} tone={attendanceSummary.late > 0 ? 'warn' : 'default'} />
                          <KpiCard icon={Clock} label="Absent" value={attendanceSummary.absent} tone={attendanceSummary.absent > 0 ? 'critical' : 'default'} />
                        </KpiStrip>
                        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                          <div className="bg-emerald-500 transition-all" style={{ width: `${(attendanceSummary.present / attendanceSummary.total) * 100}%` }} />
                          <div className="bg-amber-500 transition-all" style={{ width: `${(attendanceSummary.late / attendanceSummary.total) * 100}%` }} />
                          <div className="bg-destructive transition-all" style={{ width: `${(attendanceSummary.absent / attendanceSummary.total) * 100}%` }} />
                        </div>
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Employee profile dialog */}
      <EmployeeDetailSheet
        employee={selectedEmployee ?? null}
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
      />

      {/* Contract detail popup */}
      <ContractDetailPopup
        contract={selectedContractDetail}
        open={!!selectedContractDetail}
        onClose={() => setSelectedContractDetail(null)}
      />
    </div>
  );
}
