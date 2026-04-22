import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tag, Percent, Clock, Plus, Pause, Search, Calendar,
  Loader2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { salesApi, orgApi, type PromotionView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { normalizeNumericId } from '@/constants/pos';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { buildCreatePromotionPayload, createDefaultPromotionFormValues, type PromotionFormValues } from '@/components/promotions/promotion-form';
import { toast } from 'sonner';

interface OrgOutlet { id: string; code: string; name: string; regionId: string; }
interface OrgRegion { id: string; code: string; name: string; }

interface PromotionRow {
  id: string;
  name: string;
  promoType: string;
  status: string;
  valueAmount: number;
  valuePercent: number;
  effectiveFrom: string;
  effectiveTo?: string;
  outletIds: string[];
}

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-success/10 text-success',
  scheduled: 'bg-info/10 text-info',
  draft: 'bg-muted text-muted-foreground',
  inactive: 'bg-muted text-muted-foreground',
  expired: 'bg-destructive/10 text-destructive',
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function derivePromotionStatus(status: string, effectiveFrom: string, effectiveTo?: string) {
  const now = Date.now();
  const start = effectiveFrom ? new Date(effectiveFrom).getTime() : Number.NaN;
  const end = effectiveTo ? new Date(effectiveTo).getTime() : Number.NaN;
  if (Number.isFinite(end) && end < now) return 'expired';
  if (Number.isFinite(start) && start > now) return 'scheduled';
  return status;
}

export function PromotionsModule() {
  const { token, scope } = useShellRuntime();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<PromotionFormValues>(createDefaultPromotionFormValues);

  const outletId = normalizeNumericId(scope.outletId);
  const [outlets, setOutlets] = useState<OrgOutlet[]>([]);
  const [regions, setRegions] = useState<OrgRegion[]>([]);
  const [selectedOutletIds, setSelectedOutletIds] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    orgApi.hierarchy(token).then((h) => {
      setRegions(h.regions.map((r) => ({ id: r.id, code: r.code, name: r.name })));
      setOutlets(h.outlets.map((o) => ({ id: o.id, code: o.code, name: o.name, regionId: o.regionId })));
      setSelectedOutletIds(outletId ? [outletId] : []);
    }).catch(() => {});
  }, [token, outletId]);

  const load = useCallback(async () => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await salesApi.promotions(token, {
        outletId: outletId || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
        offset: 0,
      });

      const mapped: PromotionRow[] = (page.items || []).map((item: PromotionView) => ({
        id: String(item.id),
        name: String(item.name ?? ''),
        promoType: String(item.promoType ?? 'promotion'),
        status: derivePromotionStatus(String(item.status ?? 'draft'), String(item.effectiveFrom ?? ''), item.effectiveTo ? String(item.effectiveTo) : undefined),
        valueAmount: toNumber(item.valueAmount),
        valuePercent: toNumber(item.valuePercent),
        effectiveFrom: String(item.effectiveFrom ?? ''),
        effectiveTo: item.effectiveTo ? String(item.effectiveTo) : undefined,
        outletIds: Array.isArray(item.outletIds) ? item.outletIds.map((id) => String(id)) : [],
      }));

      setRows(mapped);
    } catch (error) {
      console.error('Failed to load promotions:', error);
      toast.error(getErrorMessage(error, 'Unable to load promotions from backend'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [outletId, statusFilter, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.id.includes(q));
  }, [rows, search]);

  const stats = useMemo(() => ({
    active: rows.filter((row) => row.status === 'active').length,
    scheduled: rows.filter((row) => row.status === 'scheduled').length,
    draft: rows.filter((row) => row.status === 'draft').length,
    inactive: rows.filter((row) => row.status === 'inactive' || row.status === 'expired').length,
  }), [rows]);

  const handleCreate = async () => {
    if (!token) {
      toast.error('Please sign in first');
      return;
    }
    if (!form.name.trim() || !form.effectiveFrom) {
      toast.error('Name and effective start are required');
      return;
    }
    if (selectedOutletIds.length === 0) {
      toast.error('Select at least one outlet');
      return;
    }

    const payload = buildCreatePromotionPayload(form, selectedOutletIds);

    try {
      await salesApi.createPromotion(token, payload);
      toast.success('Promotion created');
      setCreateOpen(false);
      setForm(createDefaultPromotionFormValues());
      setSelectedOutletIds(outletId ? [outletId] : []);
      await load();
    } catch (error) {
      console.error('Create promotion failed:', error);
      toast.error(getErrorMessage(error, 'Unable to create promotion'));
    }
  };

  const deactivate = async (promotionId: string) => {
    if (!token) return;
    try {
      await salesApi.deactivatePromotion(token, promotionId);
      toast.success('Promotion deactivated');
      await load();
    } catch (error) {
      console.error('Deactivate promotion failed:', error);
      toast.error(getErrorMessage(error, 'Unable to deactivate promotion'));
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Promotions" />;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Promotions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage promotion campaigns using live sales APIs</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New Promotion
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active', value: stats.active, icon: Tag, color: 'text-success' },
          { label: 'Scheduled', value: stats.scheduled, icon: Clock, color: 'text-info' },
          { label: 'Draft', value: stats.draft, icon: Percent, color: 'text-muted-foreground' },
          { label: 'Inactive/Expired', value: stats.inactive, icon: XCircle, color: 'text-destructive' },
        ].map((kpi) => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search promotion name or id..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {['all', 'active', 'scheduled', 'draft', 'inactive', 'expired'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                'text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize',
                statusFilter === status
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground hover:bg-accent border-border',
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <div className="surface-elevated p-6">
          <EmptyState title="No promotions found" description="No promotions matched the selected filters." />
        </div>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Promotion', 'Type', 'Value', 'Status', 'Effective Window', 'Scope', ''].map((header) => (
                  <th key={header} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium text-foreground">{row.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{row.id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.promoType}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {row.valuePercent > 0 ? `${row.valuePercent}%` : row.valueAmount > 0 ? `$${row.valueAmount.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', STATUS_CLASS[row.status] || STATUS_CLASS.draft)}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleString() : '—'}
                    </div>
                    <div className="text-[10px] mt-0.5">to {row.effectiveTo ? new Date(row.effectiveTo).toLocaleString() : 'open-ended'}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {row.outletIds.length > 0 ? `${row.outletIds.length} outlets` : 'Global'}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.status === 'active' ? (
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => void deactivate(row.id)}>
                        <Pause className="h-3 w-3" /> Deactivate
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Promotion</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Lunch 20%" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Promotion Type</Label>
                <Select value={form.promoType} onValueChange={(value) => setForm((prev) => ({ ...prev, promoType: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage discount</SelectItem>
                    <SelectItem value="fixed_amount">Fixed amount</SelectItem>
                    <SelectItem value="buy_x_get_y">Buy X get Y</SelectItem>
                    <SelectItem value="combo_price">Combo price</SelectItem>
                    <SelectItem value="subsidy">Subsidy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Value (%)</Label>
                <Input value={form.valuePercent} onChange={(event) => setForm((prev) => ({ ...prev, valuePercent: event.target.value }))} type="number" min="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Fixed Value</Label>
                <Input value={form.valueAmount} onChange={(event) => setForm((prev) => ({ ...prev, valueAmount: event.target.value }))} type="number" min="0" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Min Order Amount</Label>
                <Input value={form.minOrderAmount} onChange={(event) => setForm((prev) => ({ ...prev, minOrderAmount: event.target.value }))} type="number" min="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Effective From</Label>
                <Input type="datetime-local" value={form.effectiveFrom} onChange={(event) => setForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Effective To</Label>
                <Input type="datetime-local" value={form.effectiveTo} onChange={(event) => setForm((prev) => ({ ...prev, effectiveTo: event.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Outlets <span className="text-destructive">*</span></Label>
              {outlets.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Loading outlets...</p>
              ) : (
                <div className="rounded-md border max-h-48 overflow-y-auto divide-y">
                  {regions.map((region) => {
                    const regionOutlets = outlets.filter((o) => o.regionId === region.id);
                    if (regionOutlets.length === 0) return null;
                    const allSelected = regionOutlets.every((o) => selectedOutletIds.includes(o.id));
                    const someSelected = regionOutlets.some((o) => selectedOutletIds.includes(o.id));
                    const toggleRegion = () => {
                      if (allSelected) {
                        setSelectedOutletIds((prev) => prev.filter((id) => !regionOutlets.find((o) => o.id === id)));
                      } else {
                        setSelectedOutletIds((prev) => [...new Set([...prev, ...regionOutlets.map((o) => o.id)])]);
                      }
                    };
                    return (
                      <div key={region.id}>
                        <label className="flex items-center gap-2 cursor-pointer bg-muted/30 px-2 py-1.5 hover:bg-muted/50">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={allSelected}
                            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={toggleRegion}
                          />
                          <span className="text-[11px] font-semibold">{region.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{region.code}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{regionOutlets.filter((o) => selectedOutletIds.includes(o.id)).length}/{regionOutlets.length}</span>
                        </label>
                        <div className="divide-y">
                          {regionOutlets.map((o) => (
                            <label key={o.id} className="flex items-center gap-2 cursor-pointer px-4 py-1 hover:bg-muted/20">
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={selectedOutletIds.includes(o.id)}
                                onChange={(e) => {
                                  setSelectedOutletIds((prev) =>
                                    e.target.checked ? [...prev, o.id] : prev.filter((id) => id !== o.id)
                                  );
                                }}
                              />
                              <span className="text-[11px] font-mono">{o.code}</span>
                              <span className="text-[11px] text-muted-foreground">{o.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedOutletIds.length > 0 && (
                <p className="text-[10px] text-muted-foreground">{selectedOutletIds.length} outlet(s) selected</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void handleCreate()}>Create Promotion</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
