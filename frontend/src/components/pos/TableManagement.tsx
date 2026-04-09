import { useState, useMemo } from 'react';
import {
  ArrowLeft, Plus, Edit2, Save, Search, Users, Clock,
  CheckCircle2, AlertTriangle, Utensils, Sparkles, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DineInTable, TableStatus } from '@/types/pos';
import { mockTables, TABLE_ZONES } from '@/data/mock-pos-extended';
import { RouteUnavailableBanner, PermissionBootstrapBanner } from '@/components/pos/PlatformGapStates';

const STATUS_CONFIG: Record<TableStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  available: { label: 'Available', color: 'text-success', bg: 'bg-success/10 border-success/20', icon: CheckCircle2 },
  occupied: { label: 'Occupied', color: 'text-primary', bg: 'bg-primary/10 border-primary/20', icon: Utensils },
  reserved: { label: 'Reserved', color: 'text-warning', bg: 'bg-warning/10 border-warning/20', icon: Clock },
  cleaning: { label: 'Cleaning', color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: Sparkles },
};

type TableView =
  | { screen: 'board' }
  | { screen: 'list' }
  | { screen: 'detail'; tableId: string }
  | { screen: 'create' };

interface Props {
  onBack: () => void;
  gatewayAvailable?: boolean;
  permissionsBootstrapped?: boolean;
}

export function TableManagement({ onBack, gatewayAvailable = false, permissionsBootstrapped = false }: Props) {
  const [view, setView] = useState<TableView>({ screen: 'board' });

  const showBlocker = !gatewayAvailable || !permissionsBootstrapped;

  if (view.screen === 'detail') {
    return <TableDetail tableId={view.tableId} onBack={() => setView({ screen: 'board' })} readOnly={showBlocker} />;
  }
  if (view.screen === 'create') {
    return <TableForm onBack={() => setView({ screen: 'board' })} onSave={() => setView({ screen: 'board' })} />;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Dine-in Tables</h2>
            <p className="text-xs text-muted-foreground">Floor status — Downtown Flagship</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-md overflow-hidden">
            {(['board', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView({ screen: v })}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-medium transition-colors capitalize',
                  view.screen === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                )}
              >{v}</button>
            ))}
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setView({ screen: 'create' })} disabled={showBlocker}>
            <Plus className="h-3.5 w-3.5" /> Add Table
          </Button>
        </div>
      </div>

      {!gatewayAvailable && (
        <RouteUnavailableBanner
          title="Dine-in Table Management"
          subtitle="Table management APIs are implemented in backend source but are not yet routed through the gateway."
          routePath="/api/pos/tables/**"
          missingPermissions={['pos.table.read', 'pos.table.write', 'pos.table.manage']}
        />
      )}
      {gatewayAvailable && !permissionsBootstrapped && (
        <PermissionBootstrapBanner
          feature="Dine-in Table Management"
          permissions={['pos.table.read', 'pos.table.write', 'pos.table.manage']}
        />
      )}

      {/* Status summary */}
      <div className="flex items-center gap-3 flex-wrap">
        {(Object.keys(STATUS_CONFIG) as TableStatus[]).map(status => {
          const count = mockTables.filter(t => t.status === status).length;
          const cfg = STATUS_CONFIG[status];
          return (
            <div key={status} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium', cfg.bg)}>
              <cfg.icon className={cn('h-3 w-3', cfg.color)} />
              <span className={cfg.color}>{count} {cfg.label}</span>
            </div>
          );
        })}
      </div>

      {view.screen === 'board' ? (
        <TableStatusBoard onView={(id) => setView({ screen: 'detail', tableId: id })} dimmed={showBlocker} />
      ) : (
        <TableListView onView={(id) => setView({ screen: 'detail', tableId: id })} />
      )}

      {showBlocker && (
        <p className="text-[10px] text-muted-foreground text-center italic">
          Displaying a non-live layout because the table service or required permissions are unavailable in this environment
        </p>
      )}
    </div>
  );
}

/* ── Status Board ── */
function TableStatusBoard({ onView, dimmed }: { onView: (id: string) => void; dimmed: boolean }) {
  const [zone, setZone] = useState('All');
  const tables = useMemo(() =>
    zone === 'All' ? mockTables : mockTables.filter(t => t.zone === zone),
    [zone]
  );

  return (
    <div className={cn('space-y-4', dimmed && 'opacity-60')}>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {TABLE_ZONES.map(z => (
          <button
            key={z}
            onClick={() => setZone(z)}
            className={cn(
              'text-[11px] px-3 py-1.5 rounded-md border whitespace-nowrap transition-colors',
              zone === z
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground hover:bg-accent border-border'
            )}
          >{z}</button>
        ))}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {tables.map(table => {
          const cfg = STATUS_CONFIG[table.status];
          return (
            <button
              key={table.id}
              onClick={() => onView(table.id)}
              className={cn(
                'p-4 rounded-lg border-2 text-center transition-all hover:shadow-surface-sm',
                cfg.bg
              )}
            >
              <p className="text-lg font-bold text-foreground">{table.name}</p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <cfg.icon className={cn('h-3 w-3', cfg.color)} />
                <span className={cn('text-[10px] font-medium', cfg.color)}>{cfg.label}</span>
              </div>
              <div className="flex items-center justify-center gap-1 mt-1.5">
                <Users className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{table.capacity} seats</span>
              </div>
              {table.currentOrderNumber && (
                <p className="text-[10px] font-medium text-primary mt-1.5">{table.currentOrderNumber}</p>
              )}
              {table.reservedBy && (
                <p className="text-[10px] text-warning mt-1 truncate">{table.reservedBy}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Table List View ── */
function TableListView({ onView }: { onView: (id: string) => void }) {
  return (
    <div className="surface-elevated overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/30">
            {['Table', 'Zone', 'Capacity', 'Status', 'Order', 'Info'].map(h => (
              <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mockTables.map(table => {
            const cfg = STATUS_CONFIG[table.status];
            return (
              <tr key={table.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => onView(table.id)}>
                <td className="px-4 py-2.5 text-sm font-semibold text-foreground">{table.name}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{table.zone}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" /> {table.capacity}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', cfg.bg, cfg.color)}>
                    {cfg.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-primary font-medium">{table.currentOrderNumber || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {table.reservedBy ? `Reserved: ${table.reservedBy}` : table.occupiedSince ? `Since ${new Date(table.occupiedSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Table Detail / Edit ── */
function TableDetail({ tableId, onBack, readOnly }: {
  tableId: string;
  onBack: () => void;
  readOnly: boolean;
}) {
  const table = mockTables.find(t => t.id === tableId);
  const [status, setStatus] = useState(table?.status || 'available');

  if (!table) return <div className="p-6 text-sm text-muted-foreground">Table not found</div>;

  const cfg = STATUS_CONFIG[table.status];

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-lg">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold text-foreground">Table {table.name}</h2>
      </div>

      <div className="surface-elevated p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-foreground">{table.name}</p>
            <p className="text-xs text-muted-foreground">{table.zone} · {table.capacity} seats</p>
          </div>
          <div className={cn('px-3 py-1.5 rounded-md border flex items-center gap-1.5', cfg.bg)}>
            <cfg.icon className={cn('h-3.5 w-3.5', cfg.color)} />
            <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
          </div>
        </div>

        {table.currentOrderNumber && (
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Current Order</p>
            <p className="text-sm font-semibold text-primary">{table.currentOrderNumber}</p>
          </div>
        )}

        {table.reservedBy && (
          <div className="p-3 rounded-lg bg-warning/5 border border-warning/10">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Reservation</p>
            <p className="text-sm font-medium text-foreground">{table.reservedBy}</p>
            {table.reservedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(table.reservedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {!readOnly && (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">Update Status</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STATUS_CONFIG) as TableStatus[]).map(s => {
                const sc = STATUS_CONFIG[s];
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={cn(
                      'text-[11px] px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5',
                      status === s ? cn(sc.bg, sc.color, 'border-current') : 'text-muted-foreground border-border hover:bg-muted'
                    )}
                  >
                    <sc.icon className="h-3 w-3" />
                    {sc.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onBack}>
            <Save className="h-3.5 w-3.5" /> Save Changes
          </Button>
        </div>
      )}

      {readOnly && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border">
          <Eye className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            View-only mode because the required table service capability is not available in this environment.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Table Create Form ── */
function TableForm({ onBack, onSave }: { onBack: () => void; onSave: () => void }) {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [zone, setZone] = useState('Indoor');

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-lg">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold text-foreground">Add Table</h2>
      </div>
      <div className="surface-elevated p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Table Name / Number *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. T13, VIP-3" className="h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Capacity</label>
          <Input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" min="1" className="h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Zone</label>
          <div className="flex flex-wrap gap-1.5">
            {TABLE_ZONES.filter(z => z !== 'All').map(z => (
              <button
                key={z}
                onClick={() => setZone(z)}
                className={cn(
                  'text-[11px] px-3 py-1.5 rounded-md border transition-colors',
                  zone === z ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-muted'
                )}
              >{z}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onSave} disabled={!name.trim()}>
          <Save className="h-3.5 w-3.5" /> Create Table
        </Button>
      </div>
    </div>
  );
}

/* ── Table Assignment Picker (for Order Entry) ── */
export function TableAssignmentPicker({ onSelect, gatewayAvailable, permissionsBootstrapped }: {
  onSelect: (tableId: string) => void;
  gatewayAvailable: boolean;
  permissionsBootstrapped: boolean;
}) {
  const available = mockTables.filter(t => t.status === 'available');

  if (!gatewayAvailable || !permissionsBootstrapped) {
    return (
      <div className="p-3 rounded-lg bg-muted/30 border space-y-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-warning flex-shrink-0" />
          <p className="text-[10px] font-medium text-foreground">Dine-in Table Assignment</p>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Table assignment requires <code className="text-[9px] bg-muted px-1 rounded">/api/pos/tables/**</code> gateway routes
          {!permissionsBootstrapped && <> and <code className="text-[9px] bg-muted px-1 rounded">pos.table.*</code> IAM permissions</>}.
          The sale order model supports <code className="text-[9px] bg-muted px-1 rounded">tableId</code> — assignment will activate once platform integration is complete.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">Assign Table</p>
      <div className="flex flex-wrap gap-1.5">
        {available.map(t => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="text-[11px] px-2.5 py-1.5 rounded-md border border-success/20 bg-success/5 text-success font-medium hover:bg-success/10 transition-colors"
          >
            {t.name} ({t.capacity})
          </button>
        ))}
      </div>
    </div>
  );
}
