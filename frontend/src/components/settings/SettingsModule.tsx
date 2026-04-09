import { useState, useEffect, useCallback } from 'react';
import {
  Building2, MapPin, Globe, Palette, Settings, Plus, Trash2,
  ChevronRight, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { orgApi } from '@/api/fern-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { toast } from 'sonner';
import { EmptyState } from '@/components/shell/PermissionStates';

type SettingsTab = 'general' | 'outlets' | 'regions' | 'branding' | 'preferences';

const TABS: { key: SettingsTab; label: string; icon: React.ElementType }[] = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'outlets', label: 'Outlets', icon: Building2 },
  { key: 'regions', label: 'Regions', icon: MapPin },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'preferences', label: 'Preferences', icon: Globe },
];

interface Outlet {
  id: string;
  code?: string;
  name: string;
  region: string | null;
  address: string | null;
  status: string;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    active: 'bg-success/10 text-success',
    maintenance: 'bg-warning/10 text-warning',
    inactive: 'bg-muted text-muted-foreground',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s[status] || s.active}`}>{status}</span>;
}

/* ── General ── */
function GeneralSettings() {
  const { token, user } = useShellRuntime();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    regionCount: 0,
    outletCount: 0,
    activeOutletCount: 0,
    maintenanceOutletCount: 0,
  });

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setLoading(false);
        setStats({
          regionCount: 0,
          outletCount: 0,
          activeOutletCount: 0,
          maintenanceOutletCount: 0,
        });
        return;
      }
      setLoading(true);
      try {
        const hierarchy = await orgApi.hierarchy(token);
        const outlets = hierarchy.outlets || [];
        setStats({
          regionCount: hierarchy.regions.length,
          outletCount: outlets.length,
          activeOutletCount: outlets.filter((outlet) => String(outlet.status || '').toLowerCase() === 'active').length,
          maintenanceOutletCount: outlets.filter((outlet) => String(outlet.status || '').toLowerCase() === 'maintenance').length,
        });
      } catch (error) {
        console.error('Failed to load general settings summary:', error);
        setStats({
          regionCount: 0,
          outletCount: 0,
          activeOutletCount: 0,
          maintenanceOutletCount: 0,
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">General Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Live organization and operator context from backend APIs</p>
      </div>
      <div className="surface-elevated p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="text-2xl font-bold text-primary">{user.avatarInitials || 'OP'}</span>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">{user.displayName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
          </div>
          <StatusBadge status={user.persona || 'active'} />
        </div>
      </div>
      <div className="surface-elevated overflow-hidden">
        <div className="px-4 py-3 border-b">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Runtime Summary</span>
        </div>
        <div className="p-4 space-y-1">
          {[
            { label: 'Accessible Regions', value: String(stats.regionCount) },
            { label: 'Accessible Outlets', value: String(stats.outletCount) },
            { label: 'Active Outlets', value: String(stats.activeOutletCount) },
            { label: 'Maintenance Outlets', value: String(stats.maintenanceOutletCount) },
            { label: 'Session User', value: user.id || '—' },
            { label: 'Data Source', value: '/api/v1/org/hierarchy' },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/20 transition-colors">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
      {loading && (
        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">Refreshing summary...</div>
      )}
    </div>
  );
}

/* ── Outlet CRUD ── */
function OutletSettings() {
  const { token } = useShellRuntime();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<Outlet | null>(null);
  const [form, setForm] = useState({ name: '', region: '', address: '', status: 'active' });
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);

  const fetchOutlets = useCallback(async () => {
    if (!token) {
      setOutlets([]);
      setRegions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [hierarchy, rawOutlets] = await Promise.all([
        orgApi.hierarchy(token),
        orgApi.outlets(token),
      ]);
      const regionById = new Map(hierarchy.regions.map((region) => [region.id, region.name]));
      setRegions(hierarchy.regions.map((region) => ({ id: region.id, name: region.name })));
      setOutlets(
        rawOutlets
          .map((outlet) => ({
            id: outlet.id,
            code: outlet.code,
            name: outlet.name,
            region: regionById.get(outlet.regionId) || null,
            address: outlet.address || null,
            status: outlet.status || 'active',
            created_at: new Date().toISOString(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (error) {
      console.error('Failed to load outlets:', error);
      toast.error('Unable to load outlets from backend');
      setOutlets([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchOutlets(); }, [fetchOutlets]);

  const regionNames = [...new Set(outlets.map(o => o.region).filter(Boolean))] as string[];

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', region: '', address: '', status: 'active' });
    setDialogOpen(true);
  };

  const openEdit = (o: Outlet) => {
    setEditing(o);
    setForm({ name: o.name, region: o.region || '', address: o.address || '', status: o.status });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!token) { toast.error('Please sign in first'); return; }
    if (editing) {
      toast.error('Outlet update is not exposed by backend APIs yet');
      return;
    } else {
      const region =
        regions.find((entry) => entry.id === form.region) ||
        regions.find((entry) => entry.name === form.region) ||
        regions[0];
      if (!region) {
        toast.error('No regions available. Please seed org regions first.');
        return;
      }
      try {
        const normalizedCode = form.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'OUTLET';
        const suffix = Math.floor(10 + Math.random() * 90);
        await orgApi.createOutlet(token, {
          regionId: region.id,
          code: `${normalizedCode}${suffix}`,
          name: form.name.trim(),
          status: form.status,
          address: form.address || null,
        });
        toast.success('Outlet created');
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : 'Failed to create outlet';
        toast.error(message);
        return;
      }
    }
    setDialogOpen(false);
    await fetchOutlets();
  };

  const handleDelete = async () => {
    if (!editing) return;
    toast.error('Outlet deletion is not exposed by backend APIs');
    setDeleteOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Outlet Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {outlets.length} outlets across {regionNames.length} regions
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3 w-3" /> Add Outlet</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="surface-elevated overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Outlet', 'Region', 'Address', 'Status', ''].map(h => (
                  <th key={h} className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outlets.map(o => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openEdit(o)}>
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{o.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{o.region || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{o.address || '—'}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                </tr>
              ))}
              {outlets.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No outlets yet. Create one to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Outlet' : 'Create Outlet'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="mt-1" placeholder="e.g. Downtown Flagship" />
            </div>
            <div>
              <Label className="text-xs">Region</Label>
              <Input value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} className="mt-1" placeholder="e.g. Central Region" />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="mt-1" placeholder="e.g. 123 Main St" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select
                value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <DialogFooter className="flex justify-between gap-2">
            {editing && (
              <Button variant="destructive" size="sm" className="mr-auto h-8 text-xs gap-1" onClick={() => { setDialogOpen(false); setDeleteOpen(true); }}>
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleSave}>{editing ? 'Save Changes' : 'Create'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Outlet</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete <strong>{editing?.name}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Regions ── */
function RegionSettings() {
  const { token } = useShellRuntime();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setOutlets([]);
        setLoading(false);
        return;
      }
      try {
        const [hierarchy, rawOutlets] = await Promise.all([
          orgApi.hierarchy(token),
          orgApi.outlets(token),
        ]);
        const regionById = new Map(hierarchy.regions.map((region) => [region.id, region.name]));
        setOutlets(
          rawOutlets
            .map((outlet) => ({
              id: outlet.id,
              code: outlet.code,
              name: outlet.name,
              region: regionById.get(outlet.regionId) || null,
              address: outlet.address || null,
              status: outlet.status || 'active',
              created_at: new Date().toISOString(),
            }))
            .sort((a, b) => (a.region || '').localeCompare(b.region || '')),
        );
      } catch (error) {
        console.error('Failed to load region settings:', error);
        setOutlets([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [token]);

  const regionMap = outlets.reduce<Record<string, Outlet[]>>((acc, o) => {
    const r = o.region || 'Unassigned';
    (acc[r] = acc[r] || []).push(o);
    return acc;
  }, {});
  const regions = Object.entries(regionMap);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Region Management</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Regions are derived from outlet assignments</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {regions.map(([name, outs]) => (
            <div key={name} className="surface-elevated p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <StatusBadge status="active" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{name}</h3>
              <div className="mt-3 pt-3 border-t space-y-1">
                {outs.map(o => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{o.name}</span>
                    <StatusBadge status={o.status} />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">{outs.length} outlet{outs.length !== 1 ? 's' : ''}</p>
            </div>
          ))}
          {regions.length === 0 && (
            <p className="col-span-3 text-center text-sm text-muted-foreground py-8">No regions. Assign regions to outlets in the Outlets tab.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Branding ── */
function BrandingSettings() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Branding</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Branding configuration endpoint is not currently exposed by backend APIs</p>
      </div>
      <div className="surface-elevated p-6">
        <EmptyState
          title="Branding API not available"
          description="Backend routes for logo, palette, and platform-brand settings are not implemented in the current gateway contract."
        />
      </div>
    </div>
  );
}

/* ── Preferences ── */
function PreferencesSettings() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">System Preferences</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Preferences are read-only until backend preference endpoints are available</p>
      </div>
      <div className="surface-elevated p-6">
        <EmptyState
          title="Preferences API not available"
          description="Session timeout, notification defaults, locale, and other organization preferences are not exposed by current backend routes."
        />
      </div>
    </div>
  );
}

/* ── Main ── */
export function SettingsModule() {
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {tab === 'general' && <GeneralSettings />}
          {tab === 'outlets' && <OutletSettings />}
          {tab === 'regions' && <RegionSettings />}
          {tab === 'branding' && <BrandingSettings />}
          {tab === 'preferences' && <PreferencesSettings />}
        </div>
      </div>
    </div>
  );
}
