import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  MoreHorizontal,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  hrApi,
  type AuthUserListItem,
  type ContractView,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { EmptyState } from '@/components/shell/PermissionStates';
import {
  contractBadgeClass,
  formatHrEnumLabel,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
import { ContractDetailSheet } from '@/components/hr/ContractDetailSheet';
import { ContractRenewalDialog } from '@/components/hr/ContractRenewalDialog';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const DEFAULT_CONTRACT_FORM = {
  userId: '',
  employmentType: 'indefinite',
  salaryType: 'monthly',
  baseSalary: '',
  currencyCode: 'USD',
  regionCode: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  taxCode: '',
  bankAccount: '',
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ContractsWorkspaceProps {
  token: string;
  outletId: string | undefined;
  users: AuthUserListItem[];
  outlets: ScopeOutlet[];
  regions: ScopeRegion[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContractsWorkspace({
  token,
  outletId,
  users,
  outlets,
  regions,
}: ContractsWorkspaceProps) {
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState('');
  const [contracts, setContracts] = useState<ContractView[]>([]);
  const [contractsTotal, setContractsTotal] = useState(0);
  const [contractsHasMore, setContractsHasMore] = useState(false);
  const [contractExpiryStats, setContractExpiryStats] = useState({ active: 0, expiring: 0, terminated: 0 });
  const [busyKey, setBusyKey] = useState('');
  const [createContractDialog, setCreateContractDialog] = useState(false);
  const [contractForm, setContractForm] = useState(DEFAULT_CONTRACT_FORM);
  const [terminateDialog, setTerminateDialog] = useState<{ contractId: string; endDate: string } | null>(null);
  const [selectedContract, setSelectedContract] = useState<ContractView | null>(null);
  const [renewContract, setRenewContract] = useState<ContractView | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTerminateConfirm, setBulkTerminateConfirm] = useState(false);

  const contractsQuery = useListQueryState<{ outletId?: string; status?: string; endDateFrom?: string; endDateTo?: string }>({
    initialLimit: 20,
    initialSortBy: 'startDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const loadContracts = useCallback(async () => {
    if (!token) return;
    setContractsLoading(true);
    setContractsError('');

    const expiryWindowEnd = new Date();
    expiryWindowEnd.setDate(expiryWindowEnd.getDate() + 30);
    const expiryWindowEndStr = expiryWindowEnd.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    try {
      const [page, activeCount, expiringCount, terminatedCount] = await Promise.all([
        hrApi.contractsPaged(token, {
          ...contractsQuery.query,
          outletId: outletId || undefined,
          status: contractsQuery.filters.status,
          endDateFrom: contractsQuery.filters.endDateFrom,
          endDateTo: contractsQuery.filters.endDateTo,
        }),
        hrApi.contractsPaged(token, { outletId: outletId || undefined, status: 'active', limit: 1, offset: 0 }),
        hrApi.contractsPaged(token, {
          outletId: outletId || undefined,
          status: 'active',
          endDateFrom: todayStr,
          endDateTo: expiryWindowEndStr,
          limit: 1,
          offset: 0,
        }),
        hrApi.contractsPaged(token, { outletId: outletId || undefined, status: 'terminated', limit: 1, offset: 0 }),
      ]);
      setContracts(page.items || []);
      setContractsTotal(page.total || page.totalCount || 0);
      setContractsHasMore(page.hasMore || page.hasNextPage || false);
      setContractExpiryStats({
        active: activeCount.total || activeCount.totalCount || 0,
        expiring: expiringCount.total || expiringCount.totalCount || 0,
        terminated: terminatedCount.total || terminatedCount.totalCount || 0,
      });
    } catch (error: unknown) {
      console.error('HR contracts load failed', error);
      setContracts([]);
      setContractsTotal(0);
      setContractsHasMore(false);
      setContractsError(getErrorMessage(error, 'Unable to load contracts'));
    } finally {
      setContractsLoading(false);
    }
  }, [contractsQuery.filters.status, contractsQuery.filters.endDateFrom, contractsQuery.filters.endDateTo, contractsQuery.query, outletId, token]);

  useEffect(() => {
    contractsQuery.patchFilters({ outletId: outletId || undefined });
  }, [outletId, contractsQuery.patchFilters]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  const handleKpiClick = (type: 'active' | 'expiring' | 'terminated') => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const expiryEnd = new Date();
    expiryEnd.setDate(expiryEnd.getDate() + 30);
    const expiryEndStr = expiryEnd.toISOString().slice(0, 10);

    if (type === 'active') {
      contractsQuery.patchFilters({ status: 'active', endDateFrom: undefined, endDateTo: undefined });
    } else if (type === 'expiring') {
      contractsQuery.patchFilters({ status: 'active', endDateFrom: todayStr, endDateTo: expiryEndStr });
    } else {
      contractsQuery.patchFilters({ status: 'terminated', endDateFrom: undefined, endDateTo: undefined });
    }
  };

  const clearKpiFilter = () => {
    contractsQuery.patchFilters({ status: undefined, endDateFrom: undefined, endDateTo: undefined });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contracts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contracts.map((c) => String(c.id))));
    }
  };

  const bulkTerminate = async () => {
    if (selectedIds.size === 0 || !token) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    setBulkBusy(true);
    const results = await Promise.allSettled(
      Array.from(selectedIds).map((id) =>
        hrApi.terminateContract(token, id, { endDate: todayStr }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    if (succeeded > 0) toast.success(`${succeeded} contract(s) ended`);
    if (failed > 0) toast.error(`${failed} contract(s) failed to end`);
    setSelectedIds(new Set());
    setBulkBusy(false);
    await loadContracts();
  };

  const exportCsv = () => {
    const selectedContracts = selectedIds.size > 0
      ? contracts.filter((c) => selectedIds.has(String(c.id)))
      : contracts;
    const headers = ['ID', 'User', 'Employment Type', 'Salary Type', 'Base Salary', 'Currency', 'Start Date', 'End Date', 'Status'];
    const rows = selectedContracts.map((c) => {
      const userDisplay = getHrUserDisplay(usersById, c.userId);
      return [
        String(c.id),
        userDisplay.primary,
        String(c.employmentType || ''),
        String(c.salaryType || ''),
        String(c.baseSalary || ''),
        String(c.currencyCode || ''),
        String(c.startDate || ''),
        String(c.endDate || ''),
        String(c.status || ''),
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contracts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedContracts.length} contracts`);
  };

  const submitCreateContract = async () => {
    if (!token) return;
    const base = parseFloat(contractForm.baseSalary);
    if (!contractForm.userId.trim()) { toast.error('Select an employee'); return; }
    if (!contractForm.startDate) { toast.error('Start date is required'); return; }
    if (!base || base <= 0) { toast.error('Base salary must be a positive number'); return; }
    if (!contractForm.currencyCode.trim() || contractForm.currencyCode.trim().length !== 3) {
      toast.error('Enter a valid 3-letter currency code'); return;
    }
    setBusyKey('contract:create');
    try {
      await hrApi.createContract(token, {
        userId: contractForm.userId.trim(),
        employmentType: contractForm.employmentType,
        salaryType: contractForm.salaryType,
        baseSalary: base,
        currencyCode: contractForm.currencyCode.trim(),
        regionCode: contractForm.regionCode.trim() || null,
        startDate: contractForm.startDate,
        endDate: contractForm.endDate || null,
        taxCode: contractForm.taxCode.trim() || null,
        bankAccount: contractForm.bankAccount.trim() || null,
      });
      toast.success('Contract created');
      setCreateContractDialog(false);
      setContractForm({ ...DEFAULT_CONTRACT_FORM, startDate: new Date().toISOString().slice(0, 10) });
      await loadContracts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create contract'));
    } finally {
      setBusyKey('');
    }
  };

  const submitTerminateContract = async () => {
    if (!terminateDialog || !token) return;
    setBusyKey(`contract:terminate:${terminateDialog.contractId}`);
    try {
      await hrApi.terminateContract(token, terminateDialog.contractId, {
        endDate: terminateDialog.endDate || null,
      });
      toast.success('Contract ended');
      setTerminateDialog(null);
      await loadContracts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to end contract'));
    } finally {
      setBusyKey('');
    }
  };

  const contractStats = contractExpiryStats;

  return (
    <>
      <div className="space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { key: 'active' as const, label: 'Active Contracts', value: contractStats.active, icon: CheckCircle2 },
            { key: 'expiring' as const, label: 'Expiring Soon', value: contractStats.expiring, icon: AlertTriangle },
            { key: 'terminated' as const, label: 'Ended', value: contractStats.terminated, icon: FileText },
          ]).map((kpi) => {
            const isKpiActive = kpi.key === 'expiring'
              ? !!contractsQuery.filters.endDateFrom
              : contractsQuery.filters.status === (kpi.key === 'active' ? 'active' : 'terminated') && !contractsQuery.filters.endDateFrom;
            return (
              <button
                key={kpi.label}
                onClick={() => isKpiActive ? clearKpiFilter() : handleKpiClick(kpi.key)}
                className={cn(
                  'surface-elevated p-4 text-left transition-colors hover:bg-accent/50 relative',
                  isKpiActive ? 'bg-primary/10 border-primary/30' : '',
                )}
              >
                {isKpiActive ? (
                  <span className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></span>
                ) : null}
                <div className="flex items-center gap-1.5 mb-2">
                  <kpi.icon className={cn('h-3.5 w-3.5', isKpiActive ? 'text-primary' : 'text-muted-foreground')} />
                  <span className={cn('text-[10px] uppercase tracking-wide', isKpiActive ? 'text-primary' : 'text-muted-foreground')}>{kpi.label}</span>
                </div>
                <p className="text-xl font-semibold">{kpi.value}</p>
              </button>
            );
          })}
          {/* Employment type distribution */}
          <div className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">By Type</span>
            </div>
            <div className="space-y-1">
              {Object.entries(
                contracts.reduce<Record<string, number>>((acc, c) => {
                  const t = String(c.employmentType || 'unknown');
                  acc[t] = (acc[t] || 0) + 1;
                  return acc;
                }, {}),
              ).sort(([, a], [, b]) => b - a).slice(0, 4).map(([type, count]) => (
                <div key={type} className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">{formatHrEnumLabel(type)}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Contract table */}
        <div className="surface-elevated p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Contracts ({contractsTotal})</h3>
              <p className="text-xs text-muted-foreground">Track employment terms, salary basis, and expiry risk from the active contract register.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                  placeholder="Search contracts"
                  value={contractsQuery.searchInput}
                  onChange={(event) => contractsQuery.setSearchInput(event.target.value)}
                />
              </div>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={contractsQuery.filters.status || 'all'}
                onChange={(event) => contractsQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={`${contractsQuery.sortBy || 'startDate'}:${contractsQuery.sortDir}`}
                onChange={(event) => {
                  const [field, direction] = event.target.value.split(':');
                  contractsQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                }}
              >
                <option value="startDate:desc">Latest start date</option>
                <option value="endDate:asc">Ending soon</option>
                <option value="status:asc">Status A-Z</option>
                <option value="createdAt:desc">Last created</option>
              </select>
              <button
                onClick={() => void loadContracts()}
                disabled={contractsLoading}
                className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', contractsLoading ? 'animate-spin' : '')} /> Refresh
              </button>
              <button
                onClick={() => setCreateContractDialog(true)}
                className="h-8 px-3 rounded bg-primary text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                + New Contract
              </button>
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
              <span className="text-xs font-medium">{selectedIds.size} selected</span>
              <button
                onClick={() => setBulkTerminateConfirm(true)}
                disabled={bulkBusy}
                className="h-7 px-2.5 rounded border border-destructive/50 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50 flex items-center gap-1"
              >
                <X className="h-3 w-3" /> End selected contracts
              </button>
              <button
                onClick={exportCsv}
                className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> Export CSV
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
              >
                Clear selection
              </button>
            </div>
          ) : null}

          {contractsError ? <p className="text-xs text-destructive">{contractsError}</p> : null}

          {contracts.length === 0 && !contractsLoading ? (
            <EmptyState
              title="No contracts available"
              description="No contract rows were returned for the current scope and filters."
            />
          ) : (
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-card">
                    <th className="px-2 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === contracts.length && contracts.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-input"
                      />
                    </th>
                    {['Contract', 'Employee', 'Type', 'Base Salary', 'Period', 'Status', ''].map((header) => (
                      <th key={header} className={cn('text-xs px-4 py-2.5', header === 'Base Salary' ? 'text-right' : 'text-left')}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contractsLoading && contracts.length === 0 ? (
                    <ListTableSkeleton columns={8} rows={6} />
                  ) : contracts.map((contract) => {
                    const status = String(contract.status || 'unknown').toLowerCase();
                    const userDisplay = getHrUserDisplay(usersById, contract.userId);
                    const isActive = status === 'active' || status === 'draft';
                    return (
                      <tr
                        key={String(contract.id)}
                        className={cn('border-b last:border-0 hover:bg-accent/30 cursor-pointer transition-colors', selectedIds.has(String(contract.id)) ? 'bg-primary/5' : '')}
                        onClick={() => setSelectedContract(contract)}
                      >
                        <td className="px-2 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(String(contract.id))}
                            onChange={(e) => { e.stopPropagation(); toggleSelect(String(contract.id)); }}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-input"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{shortHrRef(contract.id)}</span>
                            <span className="text-[11px] text-muted-foreground">{String(contract.regionCode || '—')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{userDisplay.primary}</span>
                            {userDisplay.secondary ? <span className="text-[11px] text-muted-foreground">{userDisplay.secondary}</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">{formatHrEnumLabel(contract.employmentType)} · {formatHrEnumLabel(contract.salaryType)}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(contract.startDate)} — {formatDate(contract.endDate)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
                            {formatHrEnumLabel(status)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const menu = e.currentTarget.nextElementSibling;
                                if (menu) menu.classList.toggle('hidden');
                              }}
                              className="h-7 w-7 rounded hover:bg-accent flex items-center justify-center"
                            >
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                            <div className="hidden absolute right-0 top-full mt-1 z-20 w-40 rounded-md border bg-popover shadow-md py-1">
                              <button
                                onClick={() => setSelectedContract(contract)}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                              >
                                View Details
                              </button>
                              {isActive ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setSelectedContract(null);
                                      setRenewContract(contract);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                                  >
                                    Renew Contract
                                  </button>
                                  <button
                                    onClick={() => setTerminateDialog({ contractId: String(contract.id), endDate: new Date().toISOString().slice(0, 10) })}
                                    className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                  >
                                    End Contract
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <ListPaginationControls
            total={contractsTotal}
            limit={contractsQuery.limit}
            offset={contractsQuery.offset}
            hasMore={contractsHasMore}
            disabled={contractsLoading}
            onPageChange={contractsQuery.setPage}
            onLimitChange={contractsQuery.setPageSize}
          />
        </div>
      </div>

      {/* Create contract dialog */}
      {createContractDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">New Employee Contract</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Create an employment contract for an employee.</p>
              </div>
              <button type="button" onClick={() => setCreateContractDialog(false)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Employee ID <span className="text-destructive">*</span></label>
                <select
                  value={contractForm.userId}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, userId: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Select employee —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName || u.username} {u.employeeCode ? `(${u.employeeCode})` : ''}</option>
                  ))}
                </select>
                {contractForm.userId && contracts.some((c) => String(c.userId) === contractForm.userId && String(c.status || '').toLowerCase() === 'active') ? (
                  <div className="p-2 rounded-md bg-amber-50 border border-amber-200">
                    <p className="text-[10px] text-amber-800">This employee already has an active contract. Creating a new one will result in multiple active contracts.</p>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Employment Type</label>
                  <select
                    value={contractForm.employmentType}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, employmentType: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="indefinite">Indefinite</option>
                    <option value="fixed_term">Fixed Term</option>
                    <option value="probation">Probation</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="part_time">Part Time</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Salary Type</label>
                  <select
                    value={contractForm.salaryType}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, salaryType: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Base Salary <span className="text-destructive">*</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.baseSalary}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, baseSalary: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="e.g. 5000"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Currency <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    maxLength={3}
                    value={contractForm.currencyCode}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, currencyCode: e.target.value.toUpperCase() }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                    placeholder="USD"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Start Date <span className="text-destructive">*</span></label>
                  <input
                    type="date"
                    value={contractForm.startDate}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">End Date <span className="text-muted-foreground text-[10px]">(leave blank for indefinite)</span></label>
                  <input
                    type="date"
                    value={contractForm.endDate}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Region Code</label>
                  <input
                    type="text"
                    value={contractForm.regionCode}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, regionCode: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="e.g. VN"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Tax Code</label>
                  <input
                    type="text"
                    value={contractForm.taxCode}
                    onChange={(e) => setContractForm((prev) => ({ ...prev, taxCode: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Employee tax ID"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Bank Account</label>
                <input
                  type="text"
                  value={contractForm.bankAccount}
                  onChange={(e) => setContractForm((prev) => ({ ...prev, bankAccount: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Account number for salary payment"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setCreateContractDialog(false)} className="h-9 rounded-md border border-border px-4 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCreateContract()}
                disabled={busyKey === 'contract:create'}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {busyKey === 'contract:create' ? 'Creating...' : 'Create contract'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Terminate contract dialog */}
      {terminateDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold">End Contract</h3>
              <button type="button" onClick={() => setTerminateDialog(null)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-sm text-muted-foreground">This will end the contract and set the effective end date. The employee's access linked to this contract will be updated accordingly.</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Effective end date</label>
                <input
                  type="date"
                  value={terminateDialog.endDate}
                  onChange={(e) => setTerminateDialog((prev) => prev ? { ...prev, endDate: e.target.value } : prev)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Leave as today to end immediately.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setTerminateDialog(null)} className="h-9 rounded-md border border-border px-4 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitTerminateContract()}
                disabled={!!busyKey}
                className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-60"
              >
                {busyKey ? 'Ending...' : 'Confirm end'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Contract detail sheet */}
      <ContractDetailSheet
        contract={selectedContract}
        allContracts={contracts}
        usersById={usersById}
        token={token}
        users={users}
        onClose={() => setSelectedContract(null)}
        onUpdated={() => {
          setSelectedContract(null);
          void loadContracts();
        }}
        onTerminate={(contractId) => {
          setSelectedContract(null);
          setTerminateDialog({ contractId, endDate: new Date().toISOString().slice(0, 10) });
        }}
        onRenew={(contract) => {
          setSelectedContract(null);
          setRenewContract(contract);
        }}
      />

      {/* Renewal dialog */}
      {renewContract ? (
        <ContractRenewalDialog
          contract={renewContract}
          token={token}
          usersById={usersById}
          onClose={() => setRenewContract(null)}
          onRenewed={() => {
            setRenewContract(null);
            void loadContracts();
          }}
        />
      ) : null}

      {/* Bulk terminate confirmation */}
      {bulkTerminateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold">Confirm End Contracts</h3>
              <button type="button" onClick={() => setBulkTerminateConfirm(false)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-3">
              <p className="text-sm text-destructive font-medium">You are about to end {selectedIds.size} contract(s).</p>
              <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-muted-foreground">
                {contracts.filter((c) => selectedIds.has(String(c.id))).map((c) => {
                  const ud = getHrUserDisplay(usersById, c.userId);
                  return <p key={String(c.id)}>• {shortHrRef(c.id)} — {ud.primary}</p>;
                })}
              </div>
              <p className="text-xs text-muted-foreground">This will set the effective end date to today for all selected contracts.</p>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setBulkTerminateConfirm(false)} className="h-9 rounded-md border border-border px-4 text-sm">Cancel</button>
              <button
                type="button"
                onClick={() => { setBulkTerminateConfirm(false); void bulkTerminate(); }}
                disabled={bulkBusy}
                className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground disabled:opacity-60"
              >
                {bulkBusy ? 'Ending...' : `End ${selectedIds.size} contracts`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
