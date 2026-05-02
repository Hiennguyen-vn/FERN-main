import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayLocalISO } from '@/lib/date-format';
import {
  Search,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Download,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Plus,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  hrApi,
  type AuthUserListItem,
  type ContractView,
  type ContractsQuery,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { collectPagedItems } from '@/lib/collect-paged-items';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { EmptyState } from '@/components/shell/PermissionStates';
import {
  contractBadgeClass,
  formatHrEnumLabel,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
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
  startDate: todayLocalISO(),
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

  // userId → number of active contracts on current page — flags overlap risk
  const overlapUserIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of contracts) {
      const s = String(c.status || '').toLowerCase();
      if (s === 'active' || s === 'draft') {
        const uid = String(c.userId ?? '');
        if (uid) counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([uid]) => uid));
  }, [contracts]);
  const [bulkTerminateConfirm, setBulkTerminateConfirm] = useState(false);
  const [segment, setSegment] = useState<'all' | 'active' | 'expiring' | 'expired' | 'probation' | 'terminated'>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const contractsQuery = useListQueryState<{ outletId?: string; status?: string; endDateFrom?: string; endDateTo?: string }>({
    initialLimit: 20,
    initialSortBy: 'startDate',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const {
    filters: contractFilters,
    patchFilters: patchContractFilters,
    query: contractListQuery,
  } = contractsQuery;

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const loadContracts = useCallback(async () => {
    if (!token) return;
    setContractsLoading(true);
    setContractsError('');

    const expiryWindowEnd = new Date();
    expiryWindowEnd.setDate(expiryWindowEnd.getDate() + 30);
    const expiryWindowEndStr = expiryWindowEnd.toISOString().slice(0, 10);
    const todayStr = todayLocalISO();

    try {
      const [allItems, activeCount, expiringCount, terminatedCount] = await Promise.all([
        collectPagedItems<ContractView, ContractsQuery>(
          (q) => hrApi.contractsPaged(token, q),
          {
            ...contractListQuery,
            outletId: outletId || undefined,
            status: contractFilters.status,
            endDateFrom: contractFilters.endDateFrom,
            endDateTo: contractFilters.endDateTo,
          } as ContractsQuery,
          500,
        ),
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
      setContracts(allItems);
      setContractsTotal(allItems.length);
      setContractsHasMore(false);
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
  }, [contractFilters.status, contractFilters.endDateFrom, contractFilters.endDateTo, contractListQuery, outletId, token]);

  useEffect(() => {
    patchContractFilters({ outletId: outletId || undefined });
  }, [outletId, patchContractFilters]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  const handleKpiClick = (type: 'active' | 'expiring' | 'terminated') => {
    const todayStr = todayLocalISO();
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
    const todayStr = todayLocalISO();
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
    a.download = `contracts-${todayLocalISO()}.csv`;
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
      setContractForm({ ...DEFAULT_CONTRACT_FORM, startDate: todayLocalISO() });
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

  // Per-page derived counts (segment filter operates on already-paged data)
  const todayStr = todayLocalISO();
  const expiry30 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  function classifyContract(c: ContractView): 'active' | 'expiring' | 'expired' | 'probation' | 'terminated' | 'other' {
    const status = String(c.status || '').toLowerCase();
    const empType = String(c.employmentType || '').toLowerCase();
    const end = c.endDate ? String(c.endDate).slice(0, 10) : '';
    if (status === 'terminated') return 'terminated';
    if (status === 'expired') return 'expired';
    if (status === 'active') {
      if (end && end < todayStr) return 'expired';
      if (end && end >= todayStr && end <= expiry30) return 'expiring';
      if (empType === 'probation') return 'probation';
      return 'active';
    }
    return 'other';
  }

  const pageCounts = useMemo(() => {
    let active = 0;
    let expiring = 0;
    let expired = 0;
    let probation = 0;
    let terminated = 0;
    for (const c of contracts) {
      const k = classifyContract(c);
      if (k === 'active') active++;
      else if (k === 'expiring') expiring++;
      else if (k === 'expired') expired++;
      else if (k === 'probation') probation++;
      else if (k === 'terminated') terminated++;
    }
    return { all: contracts.length, active, expiring, expired, probation, terminated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts]);

  const filteredContracts = useMemo(() => {
    if (segment === 'all') return contracts;
    return contracts.filter((c) => classifyContract(c) === segment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, segment]);

  const groupedContracts = useMemo(() => {
    const map = new Map<string, ContractView[]>();
    for (const c of filteredContracts) {
      const uid = String(c.userId ?? '_unassigned');
      const arr = map.get(uid);
      if (arr) arr.push(c);
      else map.set(uid, [c]);
    }
    return Array.from(map.entries()).map(([userId, items]) => {
      const sorted = [...items].sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
      return { userId, contracts: sorted };
    });
  }, [filteredContracts]);

  const toggleGroup = (userId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  function daysUntil(date: string | null | undefined): number | null {
    if (!date) return null;
    const d = new Date(String(date));
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  }

  function severityToneFromKind(kind: ReturnType<typeof classifyContract>) {
    switch (kind) {
      case 'active': return 'active' as const;
      case 'expiring': return 'expiring' as const;
      case 'expired': return 'expired' as const;
      case 'probation': return 'expiring' as const;
      case 'terminated': return 'locked' as const;
      default: return 'neutral' as const;
    }
  }

  return (
    <>
      <div className="space-y-5">
        <WorkspaceHeader
          title="Contracts"
          subtitle="Employment terms, salary basis, and expiry risk."
          actions={
            <button
              type="button"
              onClick={() => setCreateContractDialog(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New contract
            </button>
          }
        />

        {/* Exception banner: surface expiring contracts */}
        {contractStats.expiring > 0 ? (
          <ExceptionBanner
            tone="warn"
            icon={AlertTriangle}
            message={
              <>
                <span className="font-medium">{contractStats.expiring} contract{contractStats.expiring === 1 ? '' : 's'}</span> expiring in the next 30 days.
              </>
            }
            action={
              <button
                type="button"
                onClick={() => { setSegment('expiring'); handleKpiClick('expiring'); }}
                className="inline-flex h-7 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
              >
                Review
              </button>
            }
          />
        ) : null}

        {/* KPI strip */}
        <KpiStrip cols={5}>
          <KpiCard icon={CheckCircle2} label="Active" value={contractStats.active} tone="success" />
          <KpiCard icon={AlertTriangle} label="Expiring 30d" value={contractStats.expiring} tone={contractStats.expiring > 0 ? 'warn' : 'default'} />
          <KpiCard icon={X} label="Ended" value={contractStats.terminated} />
          <KpiCard icon={FileText} label="On page" value={contracts.length} />
          <KpiCard icon={Wallet} label="Total" value={contractsTotal} />
        </KpiStrip>

        {/* Filter bar */}
        <FilterBar>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs"
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
            type="button"
            onClick={() => void loadContracts()}
            disabled={contractsLoading}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', contractsLoading ? 'animate-spin' : '')} />
            Refresh
          </button>
          {contractsQuery.filters.status || contractsQuery.filters.endDateFrom ? (
            <button
              type="button"
              onClick={clearKpiFilter}
              className="h-8 rounded-md border border-border bg-card px-2.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent"
            >
              Clear filters
            </button>
          ) : null}
        </FilterBar>

        {/* Segments */}
        <SegmentChipRow
          action={
            selectedIds.size > 0 ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{selectedIds.size} selected</span>
                <button
                  type="button"
                  onClick={() => setBulkTerminateConfirm(true)}
                  disabled={bulkBusy}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                >
                  <X className="h-3 w-3" />
                  End {selectedIds.size}
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            ) : null
          }
        >
          <SegmentChip label="All" count={pageCounts.all} active={segment === 'all'} onClick={() => setSegment('all')} />
          <SegmentChip label="Active" count={pageCounts.active} active={segment === 'active'} tone="success" onClick={() => setSegment('active')} />
          <SegmentChip label="Expiring 30d" count={pageCounts.expiring} active={segment === 'expiring'} tone="warn" onClick={() => setSegment('expiring')} />
          <SegmentChip label="Probation" count={pageCounts.probation} active={segment === 'probation'} tone="warn" onClick={() => setSegment('probation')} />
          <SegmentChip label="Expired" count={pageCounts.expired} active={segment === 'expired'} tone="critical" onClick={() => setSegment('expired')} />
          <SegmentChip label="Terminated" count={pageCounts.terminated} active={segment === 'terminated'} onClick={() => setSegment('terminated')} />
        </SegmentChipRow>

        {/* Error */}
        {contractsError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {contractsError}
          </div>
        ) : null}

        {/* Grouped list */}
        {contractsLoading && contracts.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-2">
            <ListTableSkeleton columns={4} rows={6} />
          </div>
        ) : groupedContracts.length === 0 ? (
          <EmptyState
            title="No contracts in this view"
            description="Try a different segment or status filter."
          />
        ) : (
          <div className="space-y-2">
            {groupedContracts.map((group) => {
              const userDisplay = getHrUserDisplay(usersById, group.userId);
              const initials = getInitials(userDisplay.primary);
              const collapsed = collapsedGroups.has(group.userId);
              const overlap = overlapUserIds.has(group.userId);
              const activeCount = group.contracts.filter((c) => classifyContract(c) === 'active' || classifyContract(c) === 'expiring' || classifyContract(c) === 'probation').length;
              return (
                <div key={group.userId} className="overflow-hidden rounded-md border border-border/60 bg-card">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.userId)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    {collapsed
                      ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}

                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
                      <span className="text-xs font-semibold tracking-tight text-primary">{initials}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{userDisplay.primary}</span>
                        {overlap ? (
                          <SeverityPill tone="expiring">overlap</SeverityPill>
                        ) : null}
                      </div>
                      {userDisplay.secondary ? (
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{userDisplay.secondary}</span>
                      ) : null}
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-5 text-right">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Contracts</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{group.contracts.length}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Active</p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{activeCount}</p>
                      </div>
                    </div>
                  </button>

                  {!collapsed ? (
                    <div className="border-t border-border/60 bg-muted/20">
                      {group.contracts.map((contract, idx) => {
                        const kind = classifyContract(contract);
                        const status = String(contract.status || 'unknown').toLowerCase();
                        const id = String(contract.id);
                        const isActive = status === 'active' || status === 'draft';
                        const days = daysUntil(contract.endDate);
                        return (
                          <div
                            key={id}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-accent/40',
                              idx > 0 ? 'border-t border-border/40' : '',
                              selectedIds.has(id) ? 'bg-primary/5' : '',
                            )}
                            onClick={() => setSelectedContract(contract)}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(id)}
                              onChange={(e) => { e.stopPropagation(); toggleSelect(id); }}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-input"
                            />

                            <div className="w-24 flex-shrink-0">
                              <p className="font-mono text-[10px] text-muted-foreground">#{shortHrRef(id)}</p>
                              <p className="font-mono text-[10px] text-muted-foreground/70">{String(contract.regionCode || '—')}</p>
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">
                                {formatHrEnumLabel(contract.employmentType)} · {formatHrEnumLabel(contract.salaryType)}
                              </p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">
                                {formatDate(contract.startDate)} — {formatDate(contract.endDate)}
                              </p>
                            </div>

                            <div className="hidden w-32 flex-shrink-0 text-right sm:block">
                              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Base</p>
                              <p className="font-mono text-[12px] tabular-nums text-foreground">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</p>
                            </div>

                            <div className="hidden w-28 flex-shrink-0 md:block">
                              {days !== null && days >= 0 && days <= 30 ? (
                                <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                                  {days}d left
                                </span>
                              ) : days !== null && days < 0 ? (
                                <span className="inline-flex items-center rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-destructive">
                                  {Math.abs(days)}d overdue
                                </span>
                              ) : (
                                <span className="font-mono text-[10px] text-muted-foreground">—</span>
                              )}
                            </div>

                            <SeverityPill tone={severityToneFromKind(kind)}>{formatHrEnumLabel(status)}</SeverityPill>

                            <div className="flex flex-shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {isActive ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { setSelectedContract(null); setRenewContract(contract); }}
                                    title="Renew"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setTerminateDialog({ contractId: id, endDate: todayLocalISO() })}
                                    title="End contract"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-destructive transition-colors hover:bg-destructive/10 hover:border-destructive/40"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setSelectedContract(contract)}
                                title="Details"
                                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                <MoreVertical className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {contractsTotal > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-2 text-xs">
            <span className="font-mono text-muted-foreground">{contractsTotal} contract{contractsTotal === 1 ? '' : 's'}</span>
          </div>
        ) : null}
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
          setTerminateDialog({ contractId, endDate: todayLocalISO() });
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
