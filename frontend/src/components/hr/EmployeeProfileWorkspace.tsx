import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, User, FileText, DollarSign, Clock,
  Eye, X, Phone, Mail, MapPin, Calendar, Briefcase, CreditCard,
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

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
    if (!searchTerm.trim()) return hrEmployees;
    const lower = searchTerm.toLowerCase();
    return hrEmployees.filter((e) =>
      (e.fullName || '').toLowerCase().includes(lower) ||
      (e.username || '').toLowerCase().includes(lower) ||
      (e.employeeCode || '').toLowerCase().includes(lower) ||
      (e.email || '').toLowerCase().includes(lower),
    );
  }, [hrEmployees, searchTerm]);

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
          endDate: new Date().toISOString().slice(0, 10),
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

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full">
      {/* Mobile employee selector — visible only on small screens */}
      <div className="md:hidden w-full px-1 pb-2">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
          value={selectedUserId || ''}
          onChange={(e) => setSelectedUserId(e.target.value || null)}
        >
          <option value="">— Select employee —</option>
          {filteredEmployees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.fullName || emp.username} {emp.employeeCode ? `(${emp.employeeCode})` : ''}</option>
          ))}
        </select>
      </div>

      {/* Employee list — left panel (hidden on mobile) */}
      <div className="hidden md:flex w-72 flex-shrink-0 surface-elevated flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs"
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">{filteredEmployees.length} employees</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {usersError ? (
            <div className="p-3">
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800">{usersError}</p>
              </div>
            </div>
          ) : null}
          {filteredEmployees.map((emp) => (
            <button
              key={emp.id}
              onClick={() => setSelectedUserId(emp.id)}
              className={cn(
                'w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-accent/50 transition-colors',
                selectedUserId === emp.id ? 'bg-primary/5 border-l-2 border-l-primary' : '',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{emp.fullName || emp.username}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{emp.employeeCode || emp.email || emp.username}</p>
                  {emp.activeContract ? (
                    <p className="text-[10px] text-emerald-600 truncate">{formatHrEnumLabel(emp.activeContract.employmentType)} · {formatHrEnumLabel(emp.activeContract.salaryType)}</p>
                  ) : (
                    <p className="text-[10px] text-amber-600">No active contract</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Employee detail — right panel */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {!selectedUserId ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <User className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select an employee to view their profile</p>
            </div>
          </div>
        ) : loading ? (
          <div className="surface-elevated p-4">
            <ListTableSkeleton columns={4} rows={3} />
          </div>
        ) : (
          <>
            {/* Employee header */}
            <div className="surface-elevated p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">{selectedEmployee?.fullName || selectedEmployee?.username || 'Employee'}</h2>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selectedEmployee?.employeeCode ? <span className="font-mono">{selectedEmployee.employeeCode}</span> : null}
                    {selectedEmployee?.email ? <span>· {selectedEmployee.email}</span> : null}
                    {selectedEmployee?.phone ? <span>· {selectedEmployee.phone}</span> : null}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedEmployee?.status ? (
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium',
                        selectedEmployee.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-muted text-muted-foreground border-border',
                      )}>{formatHrEnumLabel(selectedEmployee.status)}</span>
                    ) : null}
                    {selectedEmployee?.gender ? <span className="text-[10px] text-muted-foreground">{formatHrEnumLabel(selectedEmployee.gender)}</span> : null}
                    {selectedEmployee?.dob ? <span className="text-[10px] text-muted-foreground">· Born {formatDate(selectedEmployee.dob)}</span> : null}
                  </div>
                </div>
                {/* View full profile button */}
                <button
                  onClick={() => setProfileSheetOpen(true)}
                  className="h-8 px-3 rounded-md border text-xs hover:bg-accent flex items-center gap-1.5 flex-shrink-0"
                >
                  <Eye className="h-3.5 w-3.5" /> View Profile
                </button>
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="surface-elevated p-3">
                <div className="flex items-center gap-1 mb-1">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Contracts</span>
                </div>
                <p className="text-lg font-semibold">{contracts.length}</p>
                {activeContract ? (
                  <p className="text-[10px] text-emerald-600">{formatHrEnumLabel(activeContract.employmentType)}</p>
                ) : (
                  <p className="text-[10px] text-amber-600">No active contract</p>
                )}
              </div>
              <div className="surface-elevated p-3">
                <div className="flex items-center gap-1 mb-1">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Payroll Runs</span>
                </div>
                <p className="text-lg font-semibold">{payrollRuns.length}</p>
                {payrollRuns[0] ? (
                  <p className="text-[10px] text-muted-foreground">Last: {formatCurrency(payrollRuns[0].netSalary, String(payrollRuns[0].currencyCode || 'USD'))}</p>
                ) : null}
              </div>
              <div className="surface-elevated p-3">
                <div className="flex items-center gap-1 mb-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Attendance (30d)</span>
                </div>
                <p className="text-lg font-semibold">{attendanceSummary.total}</p>
                <p className="text-[10px] text-muted-foreground">
                  {attendanceSummary.present} present, {attendanceSummary.late} late
                </p>
              </div>
              <div className="surface-elevated p-3">
                <div className="flex items-center gap-1 mb-1">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Salary</span>
                </div>
                <p className="text-lg font-semibold">
                  {activeContract ? formatCurrency(activeContract.baseSalary, String(activeContract.currencyCode || 'USD')) : '—'}
                </p>
                {activeContract ? (
                  <p className="text-[10px] text-muted-foreground">{formatHrEnumLabel(activeContract.salaryType)}</p>
                ) : null}
              </div>
            </div>

            {/* Contract timeline + list */}
            {contracts.length > 0 ? (
              <div className="surface-elevated p-4">
                <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Contract History
                </h3>
                <ContractTimeline contracts={contracts} />

                <div className="mt-4 space-y-0">
                  {contracts.map((c) => {
                    const cStatus = String(c.status || 'unknown').toLowerCase();
                    return (
                      <div
                        key={String(c.id)}
                        className="flex items-center justify-between py-2.5 border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors rounded-sm px-1"
                        onClick={() => setSelectedContractDetail(c)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{shortHrRef(c.id)}</span>
                            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium', contractBadgeClass(cStatus))}>
                              {formatHrEnumLabel(cStatus)}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {formatHrEnumLabel(c.employmentType)} · {formatDate(c.startDate)} — {formatDate(c.endDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono">{formatCurrency(c.baseSalary, String(c.currencyCode || 'USD'))}</span>
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Payroll history */}
            {payrollRuns.length > 0 ? (
              <div className="surface-elevated p-4">
                <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  Payroll History
                </h3>
                <div className="space-y-0">
                  {payrollRuns.slice(0, 10).map((run) => {
                    const rStatus = String(run.status || 'unknown').toLowerCase();
                    return (
                      <div key={String(run.id)} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{run.payrollPeriodName || shortHrRef(run.id)}</span>
                            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium', payrollBadgeClass(rStatus))}>
                              {formatHrEnumLabel(rStatus)}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Base: {formatCurrency(run.baseSalaryAmount, String(run.currencyCode || 'USD'))}
                            {run.approvedAt ? ` · Approved ${formatDate(run.approvedAt)}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-mono font-semibold">
                          {formatCurrency(run.netSalary, String(run.currencyCode || 'USD'))}
                        </span>
                      </div>
                    );
                  })}
                  {payrollRuns.length > 10 ? (
                    <p className="text-[10px] text-muted-foreground pt-2">+{payrollRuns.length - 10} more runs</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Attendance summary */}
            {attendanceSummary.total > 0 ? (
              <div className="surface-elevated p-4">
                <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Attendance Summary (Last 30 Days)
                </h3>
                <div className="flex gap-3">
                  {([
                    { label: 'Present', value: attendanceSummary.present, cls: 'text-emerald-600 bg-emerald-50' },
                    { label: 'Late', value: attendanceSummary.late, cls: 'text-amber-600 bg-amber-50' },
                    { label: 'Absent', value: attendanceSummary.absent, cls: 'text-rose-600 bg-rose-50' },
                  ]).map((stat) => (
                    <div key={stat.label} className={cn('flex-1 rounded-md p-3 text-center', stat.cls)}>
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className="text-[10px] font-medium">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden flex">
                  <div className="bg-emerald-400 transition-all" style={{ width: `${(attendanceSummary.present / attendanceSummary.total) * 100}%` }} />
                  <div className="bg-amber-400 transition-all" style={{ width: `${(attendanceSummary.late / attendanceSummary.total) * 100}%` }} />
                  <div className="bg-rose-400 transition-all" style={{ width: `${(attendanceSummary.absent / attendanceSummary.total) * 100}%` }} />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Employee profile popup */}
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
