import { useState } from 'react';
import {
  Search, Plus, Eye, CheckCircle2, Clock,
  AlertTriangle, RotateCcw, Users, BarChart3, Utensils,
  Edit2, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { POSSession, POSSessionStatus } from '@/types/pos';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<POSSessionStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-success/10 text-success' },
  closed: { label: 'Closed', className: 'bg-warning/10 text-warning' },
  reconciled: { label: 'Reconciled', className: 'bg-primary/10 text-primary' },
};

interface Props {
  sessions: POSSession[];
  onOpenSession: () => void;
  onViewSession: (session: POSSession) => void;
  onCloseSession: (session: POSSession) => void;
  onReconcile: (session: POSSession) => void;
  onEditSession?: (session: POSSession) => void;
  onDeleteSession?: (session: POSSession) => void;
  onCustomerOrders?: () => void;
  onCustomers?: () => void;
  onOutletStats?: () => void;
  onTables?: () => void;
}

export function POSSessionList({
  sessions, onOpenSession, onViewSession, onCloseSession, onReconcile,
  onEditSession, onDeleteSession, onCustomerOrders, onCustomers, onOutletStats, onTables,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<POSSessionStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<POSSession | null>(null);

  const filtered = sessions.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (search && !s.code.toLowerCase().includes(search.toLowerCase()) && !s.outletName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const hasOpenSession = sessions.some(s => s.status === 'open');
  const counts = {
    all: sessions.length,
    open: sessions.filter(s => s.status === 'open').length,
    closed: sessions.filter(s => s.status === 'closed').length,
    reconciled: sessions.filter(s => s.status === 'reconciled').length,
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">POS Sessions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''} · Manage point-of-sale sessions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCustomerOrders && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onCustomerOrders}>
              <Clock className="h-3 w-3" /> Customer Orders
            </Button>
          )}
          {onCustomers && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onCustomers}>
              <Users className="h-3 w-3" /> Customers
            </Button>
          )}
          {onTables && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onTables}>
              <Utensils className="h-3 w-3" /> Tables
            </Button>
          )}
          {onOutletStats && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onOutletStats}>
              <BarChart3 className="h-3 w-3" /> Stats
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onOpenSession}>
            <Plus className="h-3 w-3" /> Open Session
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Sessions', value: counts.all, accent: 'default' },
          { label: 'Open', value: counts.open, accent: 'success' },
          { label: 'Closed', value: counts.closed, accent: 'warning' },
          { label: 'Reconciled', value: counts.reconciled, accent: 'default' },
        ].map(k => (
          <div key={k.label} className="surface-elevated p-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</p>
            <p className="text-xl font-semibold text-foreground mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* One session constraint notice */}
      {hasOpenSession && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-info/5 border border-info/10">
          <AlertTriangle className="h-3.5 w-3.5 text-info flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            Only <span className="font-medium text-foreground">one open session</span> is allowed per outlet at a time.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(['all', 'open', 'closed', 'reconciled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'text-[11px] px-2.5 py-1.5 rounded-md border transition-colors capitalize',
                statusFilter === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground hover:bg-accent border-border'
              )}
            >
              {s === 'all' ? `All (${counts.all})` : `${s} (${counts[s]})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="surface-elevated">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                {['Session Code', 'Outlet', 'Business Date', 'Opened At', 'Status', 'Closed At', 'Actions'].map((h) => (
                  <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((session) => {
                const sc = STATUS_CONFIG[session.status];
                return (
                  <tr key={session.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-primary cursor-pointer hover:underline" onClick={() => onViewSession(session)}>
                      {session.code}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground">{session.outletName}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{session.businessDate}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(session.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', sc.className)}>
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {session.closedAt ? new Date(session.closedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => onViewSession(session)} className="text-[10px] px-2 py-1 rounded border hover:bg-accent transition-colors text-foreground">
                          View
                        </button>
                        {onEditSession && (
                          <button onClick={() => onEditSession(session)} className="text-[10px] px-2 py-1 rounded border hover:bg-accent transition-colors text-foreground">
                            <Edit2 className="h-3 w-3" />
                          </button>
                        )}
                        {session.status === 'open' && (
                          <button onClick={() => onCloseSession(session)} className="text-[10px] px-2 py-1 rounded border hover:bg-accent transition-colors text-foreground">
                            Close
                          </button>
                        )}
                        {session.status === 'closed' && (
                          <button onClick={() => onReconcile(session)} className="text-[10px] px-2 py-1 rounded border border-primary/20 text-primary hover:bg-primary/5 transition-colors">
                            Reconcile
                          </button>
                        )}
                        {onDeleteSession && (
                          <button onClick={() => setDeleteTarget(session)} className="text-[10px] px-2 py-1 rounded border border-destructive/20 text-destructive hover:bg-destructive/5 transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">
                    {sessions.length === 0 ? 'No sessions yet. Open one to get started.' : 'No sessions match your filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete session <strong>{deleteTarget?.code}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => {
              if (deleteTarget && onDeleteSession) {
                onDeleteSession(deleteTarget);
                setDeleteTarget(null);
              }
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
