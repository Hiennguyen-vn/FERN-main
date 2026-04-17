import { useCallback, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Loader2,
  MapPinned,
  Plus,
  RefreshCw,
  ScrollText,
  Settings2,
  Store,
} from 'lucide-react';
import { auditApi, orgApi, type AuditLogView, type ScopeOutlet, type ScopeRegion } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useAuth } from '@/auth/use-auth';
import { isAdminSession } from '@/auth/authorization';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { cn } from '@/lib/utils';
import { EmptyState, PermissionBanner } from '@/components/shell/PermissionStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type OrgPage =
  | 'overview'
  | 'regions'
  | 'region-new'
  | 'region-detail'
  | 'outlets'
  | 'outlet-detail'
  | 'settings'
  | 'audit';

type RegionFormState = {
  code: string;
  name: string;
  parentRegionId: string;
  currencyCode: string;
  taxCode: string;
  timezoneName: string;
};

type OutletFormState = {
  code: string;
  name: string;
  regionId: string;
  address: string;
  phone: string;
  email: string;
  openedAt: string;
  closedAt: string;
  status: string;
};

const ORG_NAV = [
  { key: 'overview', label: 'Overview', icon: Building2, path: '/org/overview' },
  { key: 'regions', label: 'Regions', icon: MapPinned, path: '/org/regions' },
  { key: 'outlets', label: 'Outlets', icon: Store, path: '/org/outlets' },
  { key: 'settings', label: 'Settings', icon: Settings2, path: '/org/settings' },
  { key: 'audit', label: 'Audit', icon: ScrollText, path: '/org/audit' },
] as const;

function statusBadgeClass(status: string | null | undefined) {
  const normalized = String(status ?? '').toLowerCase();
  switch (normalized) {
    case 'active':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    case 'inactive':
      return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'closed':
      return 'border-slate-300 bg-slate-100 text-slate-700';
    case 'archived':
      return 'border-red-300 bg-red-50 text-red-700';
    default:
      return 'border-blue-300 bg-blue-50 text-blue-700';
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function resolvePage(pathname: string): OrgPage {
  if (pathname.startsWith('/org/regions/new')) return 'region-new';
  if (/^\/org\/regions\/[^/]+/.test(pathname)) return 'region-detail';
  if (/^\/org\/outlets\/[^/]+/.test(pathname)) return 'outlet-detail';
  if (pathname.startsWith('/org/regions')) return 'regions';
  if (pathname.startsWith('/org/outlets')) return 'outlets';
  if (pathname.startsWith('/org/settings')) return 'settings';
  if (pathname.startsWith('/org/audit')) return 'audit';
  return 'overview';
}

function activeNavKey(page: OrgPage) {
  if (page === 'region-new' || page === 'region-detail') return 'regions';
  if (page === 'outlet-detail') return 'outlets';
  return page;
}

function decodePathParam(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) {
    return '';
  }
  return decodeURIComponent(pathname.slice(prefix.length).split('/')[0] || '');
}

function buildRegionRows(regions: ScopeRegion[], parentRegionId: string | null = null, depth = 0): Array<ScopeRegion & { depth: number }> {
  return sortByName(regions.filter((region) => (region.parentRegionId ?? null) === parentRegionId))
    .flatMap((region) => [({ ...region, depth }), ...buildRegionRows(regions, region.id, depth + 1)]);
}

function toRegionForm(region: Pick<ScopeRegion, 'code' | 'name' | 'parentRegionId' | 'currencyCode' | 'taxCode' | 'timezoneName'>): RegionFormState {
  return {
    code: region.code,
    name: region.name,
    parentRegionId: region.parentRegionId || '',
    currencyCode: region.currencyCode || 'VND',
    taxCode: region.taxCode || '',
    timezoneName: region.timezoneName || 'Asia/Ho_Chi_Minh',
  };
}

export function OrgModule() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useShellRuntime();
  const { session } = useAuth();
  const page = resolvePage(location.pathname);
  const canMutate = isAdminSession(session ?? null);
  const currentRegionCode = page === 'region-detail' ? decodePathParam(location.pathname, '/org/regions/') : '';
  const currentOutletId = page === 'outlet-detail' ? decodePathParam(location.pathname, '/org/outlets/') : '';

  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [outletSearch, setOutletSearch] = useState('');
  const [outletRegionFilter, setOutletRegionFilter] = useState('');
  const [regionDetail, setRegionDetail] = useState<ScopeRegion | null>(null);
  const [regionDetailLoading, setRegionDetailLoading] = useState(false);
  const [regionDetailError, setRegionDetailError] = useState('');

  const [auditRows, setAuditRows] = useState<AuditLogView[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  const [creatingOutlet, setCreatingOutlet] = useState(false);
  const [outletDialogOpen, setOutletDialogOpen] = useState(false);
  const [outletForm, setOutletForm] = useState<OutletFormState>({
    code: '',
    name: '',
    regionId: '',
    address: '',
    phone: '',
    email: '',
    openedAt: '',
    closedAt: '',
    status: 'draft',
  });

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>('');
  const [statusReason, setStatusReason] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const [regionFormSubmitting, setRegionFormSubmitting] = useState(false);
  const [regionForm, setRegionForm] = useState<RegionFormState>({
    code: '',
    name: '',
    parentRegionId: '',
    currencyCode: 'VND',
    taxCode: '',
    timezoneName: 'Asia/Ho_Chi_Minh',
  });

  const [outletFormSubmitting, setOutletFormSubmitting] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('');
  const [exchangeRateUpdatedAt, setExchangeRateUpdatedAt] = useState('');
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [exchangeForm, setExchangeForm] = useState({
    fromCurrencyCode: 'USD',
    toCurrencyCode: 'VND',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
    rate: '',
  });
  const [auditSearch, setAuditSearch] = useState('');
  const [auditEntityFilter, setAuditEntityFilter] = useState<'all' | 'region' | 'outlet'>('all');

  const refreshOrgData = useCallback(async () => {
    if (!token) {
      setRegions([]);
      setOutlets([]);
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError('');
    try {
      const [regionRows, outletRows] = await Promise.all([
        orgApi.regions(token),
        orgApi.outlets(token),
      ]);
      setRegions(sortByName(regionRows));
      setOutlets(sortByName(outletRows));
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, 'Unable to load organization data'));
      setRegions([]);
      setOutlets([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  const loadRegionDetail = useCallback(async () => {
    if (!token || page !== 'region-detail' || !currentRegionCode) {
      setRegionDetail(null);
      setRegionDetailError('');
      setRegionDetailLoading(false);
      return;
    }
    setRegionDetailLoading(true);
    setRegionDetailError('');
    try {
      const detail = await orgApi.region(token, currentRegionCode);
      setRegionDetail(detail);
    } catch (loadError: unknown) {
      setRegionDetail(null);
      setRegionDetailError(getErrorMessage(loadError, 'Unable to load region detail'));
    } finally {
      setRegionDetailLoading(false);
    }
  }, [currentRegionCode, page, token]);

  const loadAudit = useCallback(async () => {
    if (!token) {
      setAuditRows([]);
      setAuditLoading(false);
      return;
    }
    setAuditLoading(true);
    setAuditError('');
    try {
      const limit = page === 'overview' ? 6 : 50;
      const [regionLogs, outletLogs] = await Promise.all([
        auditApi.logs(token, { entityName: 'region', limit, sortBy: 'createdAt', sortDir: 'desc' }),
        auditApi.logs(token, { entityName: 'outlet', limit, sortBy: 'createdAt', sortDir: 'desc' }),
      ]);
      const merged = [...(regionLogs.items || []), ...(outletLogs.items || [])]
        .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      setAuditRows(merged);
    } catch (loadError: unknown) {
      setAuditError(getErrorMessage(loadError, 'Unable to load org audit history'));
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, [page, token]);

  useEffect(() => {
    void refreshOrgData();
  }, [refreshOrgData]);

  useEffect(() => {
    void loadRegionDetail();
  }, [loadRegionDetail]);

  useEffect(() => {
    if (page !== 'overview' && page !== 'audit') {
      return;
    }
    void loadAudit();
  }, [loadAudit, page]);

  const regionById = useMemo(() => new Map(regions.map((region) => [region.id, region])), [regions]);
  const regionByCode = useMemo(() => new Map(regions.map((region) => [region.code, region])), [regions]);
  const regionRows = useMemo(() => buildRegionRows(regions), [regions]);
  const filteredRegionRows = useMemo(() => {
    const query = regionSearch.trim().toLowerCase();
    if (!query) {
      return regionRows;
    }
    return regionRows.filter((region) => {
      const parentName = region.parentRegionId ? regionById.get(region.parentRegionId)?.name || '' : '';
      return [region.name, region.code, parentName]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [regionById, regionRows, regionSearch]);
  const outletsByRegionId = useMemo(() => {
    const grouped = new Map<string, ScopeOutlet[]>();
    outlets.forEach((outlet) => {
      const current = grouped.get(outlet.regionId) ?? [];
      current.push(outlet);
      grouped.set(outlet.regionId, current);
    });
    return grouped;
  }, [outlets]);

  const selectedRegion = currentRegionCode ? regionDetail ?? regionByCode.get(currentRegionCode) ?? null : null;
  const selectedOutlet = currentOutletId ? outlets.find((outlet) => outlet.id === currentOutletId) ?? null : null;

  useEffect(() => {
    if (page !== 'region-new') {
      return;
    }
    setRegionForm({
      code: '',
      name: '',
      parentRegionId: '',
      currencyCode: 'VND',
      taxCode: '',
      timezoneName: 'Asia/Ho_Chi_Minh',
    });
  }, [page]);

  useEffect(() => {
    if (page !== 'region-detail' || !selectedRegion) {
      return;
    }
    setRegionForm(toRegionForm(selectedRegion));
  }, [page, selectedRegion]);

  useEffect(() => {
    if (!outletDialogOpen) {
      return;
    }
    setOutletForm({
      code: '',
      name: '',
      regionId: '',
      address: '',
      phone: '',
      email: '',
      openedAt: '',
      closedAt: '',
      status: 'draft',
    });
  }, [outletDialogOpen]);

  useEffect(() => {
    if (page !== 'outlet-detail' || !selectedOutlet) {
      return;
    }
    setOutletForm({
      code: selectedOutlet.code,
      name: selectedOutlet.name,
      regionId: selectedOutlet.regionId,
      address: selectedOutlet.address || '',
      phone: selectedOutlet.phone || '',
      email: selectedOutlet.email || '',
      openedAt: selectedOutlet.openedAt || '',
      closedAt: selectedOutlet.closedAt || '',
      status: selectedOutlet.status || 'draft',
    });
  }, [page, selectedOutlet]);

  const filteredOutlets = useMemo(() => {
    const query = outletSearch.trim().toLowerCase();
    return outlets.filter((outlet) => {
      if (outletRegionFilter && outlet.regionId !== outletRegionFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const regionName = regionById.get(outlet.regionId)?.name || '';
      return [outlet.name, outlet.code, outlet.address || '', regionName]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [outletRegionFilter, outletSearch, outlets, regionById]);

  const filteredAuditRows = useMemo(() => {
    return auditRows.filter((row) => {
      if (auditEntityFilter !== 'all' && row.entityName !== auditEntityFilter) {
        return false;
      }
      if (!auditSearch.trim()) {
        return true;
      }
      const haystack = [
        row.entityName,
        row.entityId,
        row.action,
        row.actorUserId,
      ].join(' ').toLowerCase();
      return haystack.includes(auditSearch.trim().toLowerCase());
    });
  }, [auditEntityFilter, auditRows, auditSearch]);

  const directOutletsForRegion = selectedRegion ? sortByName(outletsByRegionId.get(selectedRegion.id) ?? []) : [];
  const childRegionsForSelected = selectedRegion
    ? sortByName(regions.filter((region) => region.parentRegionId === selectedRegion.id))
    : [];

  const submitCreateRegion = async () => {
    if (!token) return;
    if (!regionForm.code.trim() || !regionForm.name.trim() || !regionForm.currencyCode.trim() || !regionForm.timezoneName.trim()) {
      toast.error('Code, name, currency, and timezone are required');
      return;
    }
    setRegionFormSubmitting(true);
    try {
      const region = await orgApi.createRegion(token, {
        code: regionForm.code.trim(),
        name: regionForm.name.trim(),
        parentRegionId: regionForm.parentRegionId || null,
        currencyCode: regionForm.currencyCode.trim(),
        taxCode: regionForm.taxCode.trim() || null,
        timezoneName: regionForm.timezoneName.trim(),
      });
      toast.success('Region created');
      await refreshOrgData();
      navigate(`/org/regions/${encodeURIComponent(region.code)}`);
    } catch (submitError: unknown) {
      toast.error(getErrorMessage(submitError, 'Unable to create region'));
    } finally {
      setRegionFormSubmitting(false);
    }
  };

  const submitUpdateRegion = async () => {
    if (!token || !currentRegionCode) return;
    if (!regionForm.name.trim() || !regionForm.currencyCode.trim() || !regionForm.timezoneName.trim()) {
      toast.error('Name, currency, and timezone are required');
      return;
    }
    setRegionFormSubmitting(true);
    try {
      const region = await orgApi.updateRegion(token, currentRegionCode, {
        name: regionForm.name.trim(),
        parentRegionId: regionForm.parentRegionId || null,
        currencyCode: regionForm.currencyCode.trim(),
        taxCode: regionForm.taxCode.trim() || null,
        timezoneName: regionForm.timezoneName.trim(),
      });
      setRegionDetail(region);
      setRegionForm(toRegionForm(region));
      toast.success('Region updated');
      await refreshOrgData();
      navigate(`/org/regions/${encodeURIComponent(region.code)}`, { replace: true });
    } catch (submitError: unknown) {
      toast.error(getErrorMessage(submitError, 'Unable to update region'));
    } finally {
      setRegionFormSubmitting(false);
    }
  };

  const submitCreateOutlet = async () => {
    if (!token) return;
    if (!outletForm.code.trim() || !outletForm.name.trim() || !outletForm.regionId) {
      toast.error('Code, name, and region are required');
      return;
    }
    setCreatingOutlet(true);
    try {
      const outlet = await orgApi.createOutlet(token, {
        code: outletForm.code.trim(),
        name: outletForm.name.trim(),
        regionId: outletForm.regionId,
        address: outletForm.address.trim() || null,
        phone: outletForm.phone.trim() || null,
        email: outletForm.email.trim() || null,
        status: outletForm.status,
        openedAt: outletForm.openedAt || null,
        closedAt: outletForm.closedAt || null,
      });
      toast.success('Outlet created');
      setOutletDialogOpen(false);
      await refreshOrgData();
      navigate(`/org/outlets/${encodeURIComponent(outlet.id)}`);
    } catch (submitError: unknown) {
      toast.error(getErrorMessage(submitError, 'Unable to create outlet'));
    } finally {
      setCreatingOutlet(false);
    }
  };

  const submitUpdateOutlet = async () => {
    if (!token || !selectedOutlet) return;
    if (!outletForm.code.trim() || !outletForm.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    setOutletFormSubmitting(true);
    try {
      await orgApi.updateOutlet(token, selectedOutlet.id, {
        code: outletForm.code.trim(),
        name: outletForm.name.trim(),
        address: outletForm.address.trim() || null,
        phone: outletForm.phone.trim() || null,
        email: outletForm.email.trim() || null,
        openedAt: outletForm.openedAt || null,
        closedAt: outletForm.closedAt || null,
      });
      toast.success('Outlet updated');
      await refreshOrgData();
    } catch (submitError: unknown) {
      toast.error(getErrorMessage(submitError, 'Unable to update outlet'));
    } finally {
      setOutletFormSubmitting(false);
    }
  };

  const submitStatusChange = async () => {
    if (!token || !selectedOutlet || !pendingStatus) return;
    setStatusSubmitting(true);
    try {
      const outlet = await orgApi.updateOutletStatus(token, selectedOutlet.id, {
        targetStatus: pendingStatus,
        reason: statusReason.trim() || null,
      });
      toast.success(`Outlet marked ${outlet.status}`);
      setStatusDialogOpen(false);
      setPendingStatus('');
      setStatusReason('');
      await refreshOrgData();
      if (outlet.status === 'archived') {
        navigate('/org/outlets');
      }
    } catch (submitError: unknown) {
      toast.error(getErrorMessage(submitError, 'Unable to change outlet status'));
    } finally {
      setStatusSubmitting(false);
    }
  };

  const loadExchangeRate = async () => {
    if (!token) return;
    setExchangeLoading(true);
    try {
      const rate = await orgApi.exchangeRate(
        token,
        exchangeForm.fromCurrencyCode.trim(),
        exchangeForm.toCurrencyCode.trim(),
        exchangeForm.effectiveFrom || undefined,
      );
      setExchangeRate(rate.rate);
      setExchangeRateUpdatedAt(rate.updatedAt || '');
    } catch (lookupError: unknown) {
      setExchangeRate('');
      setExchangeRateUpdatedAt('');
      toast.error(getErrorMessage(lookupError, 'Exchange rate not found'));
    } finally {
      setExchangeLoading(false);
    }
  };

  const saveExchangeRate = async () => {
    if (!token) return;
    if (!exchangeForm.rate.trim() || !exchangeForm.effectiveFrom) {
      toast.error('Rate and effective from date are required');
      return;
    }
    setExchangeLoading(true);
    try {
      const result = await orgApi.upsertExchangeRate(token, {
        fromCurrencyCode: exchangeForm.fromCurrencyCode.trim(),
        toCurrencyCode: exchangeForm.toCurrencyCode.trim(),
        rate: Number(exchangeForm.rate),
        effectiveFrom: exchangeForm.effectiveFrom,
        effectiveTo: exchangeForm.effectiveTo || null,
      });
      setExchangeRate(result.rate);
      setExchangeRateUpdatedAt(result.updatedAt || '');
      toast.success('Exchange rate saved');
    } catch (saveError: unknown) {
      toast.error(getErrorMessage(saveError, 'Unable to save exchange rate'));
    } finally {
      setExchangeLoading(false);
    }
  };

  const openStatusDialog = (targetStatus: string) => {
    setPendingStatus(targetStatus);
    setStatusReason('');
    setStatusDialogOpen(true);
  };

  const handleCreateRegionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCreateRegion();
  };

  const handleUpdateRegionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitUpdateRegion();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0 overflow-x-auto">
        {ORG_NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => navigate(item.path)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
              activeNavKey(page) === item.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pl-4">
          <button
            onClick={() => void refreshOrgData()}
            disabled={refreshing}
            className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing ? 'animate-spin' : '')} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!canMutate ? (
          <PermissionBanner
            state="read_only"
            moduleName="Organization"
            detail="You can view org structure and outlet state, but only admin or superadmin can change master data."
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {page === 'overview' && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { label: 'Visible regions', value: regions.length, tone: 'text-blue-700 bg-blue-50 border-blue-200' },
                { label: 'Visible outlets', value: outlets.length, tone: 'text-slate-700 bg-slate-50 border-slate-200' },
                { label: 'Active outlets', value: outlets.filter((outlet) => outlet.status === 'active').length, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                { label: 'Inactive / closed', value: outlets.filter((outlet) => outlet.status === 'inactive' || outlet.status === 'closed').length, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
              ].map((card) => (
                <div key={card.label} className={cn('surface-elevated border p-5', card.tone)}>
                  <p className="text-xs uppercase tracking-wide">{card.label}</p>
                  <p className="mt-3 text-3xl font-semibold">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.3fr,0.7fr]">
              <div className="surface-elevated p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Region tree</h2>
                    <p className="text-xs text-muted-foreground mt-1">Backed by `core.region.parent_region_id`</p>
                  </div>
                  {canMutate ? (
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate('/org/regions/new')}>
                      <Plus className="h-3.5 w-3.5" />
                      New region
                    </Button>
                  ) : null}
                </div>
                {regionRows.length === 0 ? (
                  <EmptyState title="No regions found" description="Seed at least one region before using the org module." />
                ) : (
                  <div className="space-y-2">
                    {regionRows.slice(0, 8).map((region) => (
                      <button
                        key={region.id}
                        onClick={() => navigate(`/org/regions/${encodeURIComponent(region.code)}`)}
                        className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div style={{ paddingLeft: `${region.depth * 18}px` }}>
                            <p className="text-sm font-medium">{region.name}</p>
                            <p className="text-[11px] text-muted-foreground">{region.code}</p>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {(outletsByRegionId.get(region.id) ?? []).length} direct outlets
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="surface-elevated p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Quick actions</h2>
                      <p className="text-xs text-muted-foreground mt-1">Phase 1 ORG admin flows</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <button onClick={() => navigate('/org/regions')} className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20">
                      <p className="text-sm font-medium">Browse region tree</p>
                      <p className="text-xs text-muted-foreground">Inspect parent-child structure and settings</p>
                    </button>
                    <button onClick={() => navigate('/org/outlets')} className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20">
                      <p className="text-sm font-medium">Manage outlets</p>
                      <p className="text-xs text-muted-foreground">Create outlets and control lifecycle state</p>
                    </button>
                    <button onClick={() => navigate('/org/settings')} className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20">
                      <p className="text-sm font-medium">Review org settings</p>
                      <p className="text-xs text-muted-foreground">Region currency, tax, timezone, and exchange rates</p>
                    </button>
                  </div>
                </div>

                <div className="surface-elevated p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Recent org changes</h2>
                      <p className="text-xs text-muted-foreground mt-1">Pulled from audit-service</p>
                    </div>
                    <button className="text-xs text-primary" onClick={() => navigate('/org/audit')}>Open audit</button>
                  </div>
                  {auditLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : auditRows.length === 0 ? (
                    <EmptyState title="No org audit yet" description="Region and outlet changes will appear here after events are consumed." />
                  ) : (
                    <div className="space-y-2">
                      {auditRows.slice(0, 6).map((row) => (
                        <div key={row.id} className="rounded-lg border px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{row.entityName} · {row.entityId || '—'}</p>
                              <p className="text-[11px] text-muted-foreground">{row.action || 'update'} by {row.actorUserId || 'system'}</p>
                            </div>
                            <span className="text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {auditError ? <p className="text-xs text-destructive">{auditError}</p> : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {page === 'regions' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Regions</h2>
                <p className="text-xs text-muted-foreground mt-1">Visible region hierarchy with direct outlet counts</p>
              </div>
              {canMutate ? (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate('/org/regions/new')}>
                  <Plus className="h-3.5 w-3.5" />
                  Create region
                </Button>
              ) : null}
            </div>
            <div className="surface-elevated p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Input
                  value={regionSearch}
                  onChange={(event) => setRegionSearch(event.target.value)}
                  placeholder="Search region by name, code, or parent"
                  className="md:w-80"
                />
                <p className="text-xs text-muted-foreground">
                  Showing {filteredRegionRows.length} of {regionRows.length} regions
                </p>
              </div>
            </div>
            {filteredRegionRows.length === 0 ? (
              <EmptyState title="No regions found" description="Create the first region to build the org tree." />
            ) : (
              <div className="surface-elevated overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px]">Region</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Parent</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Currency</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Timezone</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Direct outlets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegionRows.map((region) => (
                      <tr
                        key={region.id}
                        className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                        onClick={() => navigate(`/org/regions/${encodeURIComponent(region.code)}`)}
                      >
                        <td className="px-4 py-2.5">
                          <div style={{ paddingLeft: `${region.depth * 18}px` }}>
                            <p className="text-sm font-medium">{region.name}</p>
                            <p className="text-[11px] text-muted-foreground">{region.code}</p>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {region.parentRegionId ? regionById.get(region.parentRegionId)?.name || region.parentRegionId : 'Root'}
                        </td>
                        <td className="px-4 py-2.5 text-xs">{region.currencyCode || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{region.timezoneName || '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{(outletsByRegionId.get(region.id) ?? []).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {page === 'region-new' && (
          <div className="space-y-5 max-w-3xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Create region</h2>
                <p className="text-xs text-muted-foreground mt-1">Add a new node into the existing region tree</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/org/regions')}>Back</Button>
            </div>
            <form className="surface-elevated p-5 space-y-4" onSubmit={handleCreateRegionSubmit}>
              <OrgRegionForm
                form={regionForm}
                setForm={setRegionForm}
                regions={regions}
                disableCode={false}
                excludeRegionId={null}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/org/regions')}>Cancel</Button>
                <Button type="submit" size="sm" className="h-8 text-xs" disabled={regionFormSubmitting || !canMutate}>
                  {regionFormSubmitting ? 'Saving...' : 'Create region'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {page === 'region-detail' && (
          <div className="space-y-5">
            {regionDetailLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !selectedRegion ? (
              <EmptyState title="Region not found" description="This region is not visible in your current org scope." />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedRegion.name}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{selectedRegion.code}</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/org/regions')}>Back to regions</Button>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
                  <form className="surface-elevated p-5 space-y-4" onSubmit={handleUpdateRegionSubmit}>
                    <div>
                      <h3 className="text-sm font-semibold">Region metadata</h3>
                      <p className="text-xs text-muted-foreground mt-1">Code is immutable in phase 1. Parent and operational settings stay in ORG.</p>
                    </div>
                    <OrgRegionForm
                      form={regionForm}
                      setForm={setRegionForm}
                      regions={regions}
                      disableCode
                      excludeRegionId={selectedRegion.id}
                    />
                    {regionDetailError ? <p className="text-xs text-destructive">{regionDetailError}</p> : null}
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" className="h-8 text-xs" disabled={!canMutate || regionFormSubmitting}>
                        {regionFormSubmitting ? 'Saving...' : 'Save region'}
                      </Button>
                    </div>
                  </form>

                  <div className="space-y-6">
                    <div className="surface-elevated p-5">
                      <h3 className="text-sm font-semibold">Child regions</h3>
                      <div className="mt-3 space-y-2">
                        {childRegionsForSelected.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No child regions.</p>
                        ) : childRegionsForSelected.map((region) => (
                          <button
                            key={region.id}
                            onClick={() => navigate(`/org/regions/${encodeURIComponent(region.code)}`)}
                            className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20"
                          >
                            <p className="text-sm font-medium">{region.name}</p>
                            <p className="text-[11px] text-muted-foreground">{region.code}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="surface-elevated p-5">
                      <h3 className="text-sm font-semibold">Direct outlets</h3>
                      <div className="mt-3 space-y-2">
                        {directOutletsForRegion.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No direct outlets.</p>
                        ) : directOutletsForRegion.map((outlet) => (
                          <button
                            key={outlet.id}
                            onClick={() => navigate(`/org/outlets/${encodeURIComponent(outlet.id)}`)}
                            className="w-full rounded-lg border px-4 py-3 text-left hover:bg-muted/20"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">{outlet.name}</p>
                                <p className="text-[11px] text-muted-foreground">{outlet.code}</p>
                              </div>
                              <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', statusBadgeClass(outlet.status))}>
                                {outlet.status}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {page === 'outlets' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Outlets</h2>
                <p className="text-xs text-muted-foreground mt-1">Read and manage outlet master data under the current visible scope</p>
              </div>
              {canMutate ? (
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOutletDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Create outlet
                </Button>
              ) : null}
            </div>
            <div className="surface-elevated p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Input
                  value={outletSearch}
                  onChange={(event) => setOutletSearch(event.target.value)}
                  placeholder="Search outlet by name, code, address, or region"
                  className="md:w-80"
                />
                <select
                  value={outletRegionFilter}
                  onChange={(event) => setOutletRegionFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm md:w-72"
                >
                  <option value="">All regions</option>
                  {sortByName(regions).map((region) => (
                    <option key={region.id} value={region.id}>{region.name} · {region.code}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Showing {filteredOutlets.length} of {outlets.length} outlets
                </p>
              </div>
            </div>
            {filteredOutlets.length === 0 ? (
              <EmptyState title="No outlets found" description="Create an outlet or widen the current scope filter." />
            ) : (
              <div className="surface-elevated overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px]">Outlet</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Region</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Address</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOutlets.map((outlet) => (
                      <tr
                        key={outlet.id}
                        className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                        onClick={() => navigate(`/org/outlets/${encodeURIComponent(outlet.id)}`)}
                      >
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium">{outlet.name}</p>
                          <p className="text-[11px] text-muted-foreground">{outlet.code}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{regionById.get(outlet.regionId)?.name || outlet.regionId}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{outlet.address || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', statusBadgeClass(outlet.status))}>
                            {outlet.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(outlet.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {page === 'outlet-detail' && (
          <div className="space-y-5">
            {!selectedOutlet ? (
              <EmptyState title="Outlet not found" description="This outlet is not visible in your current org scope." />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedOutlet.name}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{selectedOutlet.code} · {regionById.get(selectedOutlet.regionId)?.name || selectedOutlet.regionId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', statusBadgeClass(selectedOutlet.status))}>
                      {selectedOutlet.status}
                    </span>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/org/outlets')}>Back to outlets</Button>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
                  <div className="surface-elevated p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold">Outlet master data</h3>
                      <p className="text-xs text-muted-foreground mt-1">Region parent is fixed in phase 1. Move outlet is intentionally out of scope.</p>
                    </div>
                    <OrgOutletForm form={outletForm} setForm={setOutletForm} regions={regions} disableRegion />
                    <div className="flex justify-end">
                      <Button size="sm" className="h-8 text-xs" onClick={() => void submitUpdateOutlet()} disabled={!canMutate || outletFormSubmitting || selectedOutlet.status === 'archived'}>
                        {outletFormSubmitting ? 'Saving...' : 'Save outlet'}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="surface-elevated p-5">
                      <h3 className="text-sm font-semibold">Lifecycle actions</h3>
                      <p className="text-xs text-muted-foreground mt-1">Uses `core.outlet.status` and `deleted_at`; archive hides the outlet from hierarchy reads.</p>
                      <div className="mt-4 grid gap-2">
                        {selectedOutlet.status === 'draft' ? (
                          <>
                            <StatusActionButton label="Activate" detail="Open this outlet for normal operations." onClick={() => openStatusDialog('active')} disabled={!canMutate} />
                            <StatusActionButton label="Suspend" detail="Marks the outlet inactive without closing it." onClick={() => openStatusDialog('inactive')} disabled={!canMutate} />
                            <StatusActionButton label="Close" detail="Close before archive." onClick={() => openStatusDialog('closed')} disabled={!canMutate} />
                          </>
                        ) : null}
                        {selectedOutlet.status === 'active' ? (
                          <>
                            <StatusActionButton label="Suspend" detail="Set lifecycle to inactive." onClick={() => openStatusDialog('inactive')} disabled={!canMutate} />
                            <StatusActionButton label="Close" detail="Stop operating this outlet." onClick={() => openStatusDialog('closed')} disabled={!canMutate} />
                          </>
                        ) : null}
                        {selectedOutlet.status === 'inactive' ? (
                          <>
                            <StatusActionButton label="Reactivate" detail="Restore outlet back to active." onClick={() => openStatusDialog('active')} disabled={!canMutate} />
                            <StatusActionButton label="Close" detail="Close before archive." onClick={() => openStatusDialog('closed')} disabled={!canMutate} />
                          </>
                        ) : null}
                        {selectedOutlet.status === 'closed' ? (
                          <StatusActionButton label="Archive" detail="Final destructive step. This outlet will disappear from default org reads." onClick={() => openStatusDialog('archived')} disabled={!canMutate} destructive />
                        ) : null}
                        {selectedOutlet.status === 'archived' ? (
                          <p className="text-sm text-muted-foreground">Archived outlets are immutable in phase 1.</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="surface-elevated p-5 space-y-3">
                      <h3 className="text-sm font-semibold">Operational snapshot</h3>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <InfoTile label="Region" value={regionById.get(selectedOutlet.regionId)?.name || selectedOutlet.regionId} />
                        <InfoTile label="Opened" value={formatDate(selectedOutlet.openedAt)} />
                        <InfoTile label="Closed" value={formatDate(selectedOutlet.closedAt)} />
                        <InfoTile label="Email" value={selectedOutlet.email || '—'} />
                        <InfoTile label="Phone" value={selectedOutlet.phone || '—'} />
                        <InfoTile label="Address" value={selectedOutlet.address || '—'} />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {page === 'settings' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">ORG settings</h2>
              <p className="text-xs text-muted-foreground mt-1">Phase 1 covers region operational settings and exchange rates only. Outlet-level override is intentionally excluded.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
              <div className="surface-elevated p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Region operational settings</h3>
                    <p className="text-xs text-muted-foreground mt-1">Edit from region detail to keep parent-child context explicit.</p>
                  </div>
                </div>
                {regions.length === 0 ? (
                  <EmptyState title="No regions available" description="Create a region before configuring org settings." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-2.5 text-left text-[11px]">Region</th>
                          <th className="px-4 py-2.5 text-left text-[11px]">Currency</th>
                          <th className="px-4 py-2.5 text-left text-[11px]">Tax code</th>
                          <th className="px-4 py-2.5 text-left text-[11px]">Timezone</th>
                          <th className="px-4 py-2.5 text-left text-[11px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {regionRows.map((region) => (
                          <tr key={region.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5">
                              <div style={{ paddingLeft: `${region.depth * 18}px` }}>
                                <p className="text-sm font-medium">{region.name}</p>
                                <p className="text-[11px] text-muted-foreground">{region.code}</p>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs">{region.currencyCode || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{region.taxCode || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{region.timezoneName || '—'}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button className="text-xs text-primary" onClick={() => navigate(`/org/regions/${encodeURIComponent(region.code)}`)}>
                                Open region
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="surface-elevated p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Exchange rates</h3>
                  <p className="text-xs text-muted-foreground mt-1">Backed by `/api/v1/org/exchange-rates`</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">From currency</Label>
                    <Input value={exchangeForm.fromCurrencyCode} onChange={(event) => setExchangeForm((current) => ({ ...current, fromCurrencyCode: event.target.value.toUpperCase() }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">To currency</Label>
                    <Input value={exchangeForm.toCurrencyCode} onChange={(event) => setExchangeForm((current) => ({ ...current, toCurrencyCode: event.target.value.toUpperCase() }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Effective from</Label>
                    <Input type="date" value={exchangeForm.effectiveFrom} onChange={(event) => setExchangeForm((current) => ({ ...current, effectiveFrom: event.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Effective to</Label>
                    <Input type="date" value={exchangeForm.effectiveTo} onChange={(event) => setExchangeForm((current) => ({ ...current, effectiveTo: event.target.value }))} className="mt-1" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Rate</Label>
                    <Input value={exchangeForm.rate} onChange={(event) => setExchangeForm((current) => ({ ...current, rate: event.target.value }))} className="mt-1" placeholder="e.g. 25750" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-8 text-xs" onClick={() => void loadExchangeRate()} disabled={exchangeLoading}>Lookup</Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void saveExchangeRate()} disabled={!canMutate || exchangeLoading}>Save rate</Button>
                </div>
                <div className="rounded-lg border px-4 py-3 text-xs">
                  <p className="font-medium text-foreground">Current rate</p>
                  <p className="mt-1 text-muted-foreground">{exchangeRate || '—'}</p>
                  <p className="mt-1 text-muted-foreground">Updated: {formatDateTime(exchangeRateUpdatedAt)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {page === 'audit' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">ORG audit</h2>
                <p className="text-xs text-muted-foreground mt-1">Merged region and outlet audit logs from audit-service</p>
              </div>
            </div>
            <div className="surface-elevated p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <Input
                  className="md:w-72"
                  value={auditSearch}
                  onChange={(event) => setAuditSearch(event.target.value)}
                  placeholder="Search entity, actor, action"
                />
                <select
                  value={auditEntityFilter}
                  onChange={(event) => setAuditEntityFilter(event.target.value as 'all' | 'region' | 'outlet')}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All entities</option>
                  <option value="region">Region</option>
                  <option value="outlet">Outlet</option>
                </select>
                <button
                  onClick={() => void loadAudit()}
                  disabled={auditLoading}
                  className="h-10 px-3 rounded border text-xs flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', auditLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
              {auditError ? <p className="text-xs text-destructive">{auditError}</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px]">Time</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Action</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Entity</th>
                      <th className="px-4 py-2.5 text-left text-[11px]">Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLoading && filteredAuditRows.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading audit logs...</td></tr>
                    ) : filteredAuditRows.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No org audit logs found</td></tr>
                    ) : filteredAuditRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-2.5 text-xs">{row.action || 'update'}</td>
                        <td className="px-4 py-2.5 text-xs">{row.entityName} · {row.entityId || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.actorUserId || 'system'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={outletDialogOpen} onOpenChange={setOutletDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create outlet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <OrgOutletForm form={outletForm} setForm={setOutletForm} regions={regions} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOutletDialogOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => void submitCreateOutlet()} disabled={!canMutate || creatingOutlet}>
              {creatingOutlet ? 'Creating...' : 'Create outlet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change outlet status</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border px-4 py-3 text-sm">
              <p className="font-medium">Target status: {pendingStatus || '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Inactive, closed, and archived changes require a reason. Archive will remove the outlet from default org hierarchy reads.
              </p>
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} className="mt-1 min-h-24" placeholder="Enter the business reason for this status change" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              variant={pendingStatus === 'archived' ? 'destructive' : 'default'}
              onClick={() => void submitStatusChange()}
              disabled={!canMutate || statusSubmitting}
            >
              {statusSubmitting ? 'Saving...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrgRegionForm({
  form,
  setForm,
  regions,
  disableCode,
  excludeRegionId,
}: {
  form: RegionFormState;
  setForm: Dispatch<SetStateAction<RegionFormState>>;
  regions: ScopeRegion[];
  disableCode: boolean;
  excludeRegionId: string | null;
}) {
  const selectableRegions = regions.filter((region) => region.id !== excludeRegionId);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Label className="text-xs">Code</Label>
        <Input value={form.code} disabled={disableCode} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Name</Label>
        <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Parent region</Label>
        <select
          value={form.parentRegionId}
          onChange={(event) => setForm((current) => ({ ...current, parentRegionId: event.target.value }))}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Root</option>
          {sortByName(selectableRegions).map((region) => (
            <option key={region.id} value={region.id}>{region.name} · {region.code}</option>
          ))}
        </select>
      </div>
      <div>
        <Label className="text-xs">Currency</Label>
        <Input value={form.currencyCode} onChange={(event) => setForm((current) => ({ ...current, currencyCode: event.target.value.toUpperCase() }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Tax code</Label>
        <Input value={form.taxCode} onChange={(event) => setForm((current) => ({ ...current, taxCode: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Timezone</Label>
        <Input value={form.timezoneName} onChange={(event) => setForm((current) => ({ ...current, timezoneName: event.target.value }))} className="mt-1" />
      </div>
    </div>
  );
}

function OrgOutletForm({
  form,
  setForm,
  regions,
  disableRegion = false,
}: {
  form: OutletFormState;
  setForm: Dispatch<SetStateAction<OutletFormState>>;
  regions: ScopeRegion[];
  disableRegion?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <Label className="text-xs">Code</Label>
        <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Name</Label>
        <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Region</Label>
        <select
          value={form.regionId}
          disabled={disableRegion}
          onChange={(event) => setForm((current) => ({ ...current, regionId: event.target.value }))}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-70"
        >
          <option value="">Select region</option>
          {sortByName(regions).map((region) => (
            <option key={region.id} value={region.id}>{region.name} · {region.code}</option>
          ))}
        </select>
      </div>
      <div>
        <Label className="text-xs">Status</Label>
        <select
          value={form.status}
          onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Address</Label>
        <Input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Phone</Label>
        <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Email</Label>
        <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Opened at</Label>
        <Input type="date" value={form.openedAt} onChange={(event) => setForm((current) => ({ ...current, openedAt: event.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Closed at</Label>
        <Input type="date" value={form.closedAt} onChange={(event) => setForm((current) => ({ ...current, closedAt: event.target.value }))} className="mt-1" />
      </div>
    </div>
  );
}

function StatusActionButton({
  label,
  detail,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60',
        destructive ? 'hover:bg-red-50 border-red-200' : 'hover:bg-muted/20'
      )}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">{detail}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
