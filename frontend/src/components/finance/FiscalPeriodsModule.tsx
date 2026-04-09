import { useState } from 'react';
import { Plus, Lock, Unlock, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed' | 'locked';
  transactions: number;
  revenue: number;
}

const INITIAL_PERIODS: FiscalPeriod[] = [
  { id: '1', name: 'FY2026 Q1', startDate: '2026-01-01', endDate: '2026-03-31', status: 'closed', transactions: 12480, revenue: 284000 },
  { id: '2', name: 'FY2026 Q2', startDate: '2026-04-01', endDate: '2026-06-30', status: 'open', transactions: 1250, revenue: 42000 },
  { id: '3', name: 'FY2026 Q3', startDate: '2026-07-01', endDate: '2026-09-30', status: 'locked', transactions: 0, revenue: 0 },
  { id: '4', name: 'FY2026 Q4', startDate: '2026-10-01', endDate: '2026-12-31', status: 'locked', transactions: 0, revenue: 0 },
  { id: '5', name: 'FY2025 Q4', startDate: '2025-10-01', endDate: '2025-12-31', status: 'closed', transactions: 14200, revenue: 312000 },
  { id: '6', name: 'FY2025 Q3', startDate: '2025-07-01', endDate: '2025-09-30', status: 'closed', transactions: 13500, revenue: 298000 },
];

const STATUS_STYLES: Record<string, { cls: string; icon: React.ElementType }> = {
  open: { cls: 'bg-success/10 text-success', icon: Unlock },
  closed: { cls: 'bg-muted text-muted-foreground', icon: Lock },
  locked: { cls: 'bg-warning/10 text-warning', icon: Lock },
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

const emptyForm = { name: '', startDate: '', endDate: '' };

export function FiscalPeriodsModule() {
  const [periods, setPeriods] = useState<FiscalPeriod[]>(INITIAL_PERIODS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [actionTarget, setActionTarget] = useState<{ period: FiscalPeriod; action: 'close' | 'reopen' } | null>(null);

  const openPeriod = periods.find(p => p.status === 'open');

  const handleCreate = () => {
    if (!form.name || !form.startDate || !form.endDate) { toast.error('All fields are required'); return; }
    const newPeriod: FiscalPeriod = { id: `fp-${Date.now()}`, name: form.name, startDate: form.startDate, endDate: form.endDate, status: 'open', transactions: 0, revenue: 0 };
    setPeriods(prev => [newPeriod, ...prev]);
    toast.success(`Period "${form.name}" created`);
    setDialogOpen(false);
    setForm(emptyForm);
  };

  const handleAction = () => {
    if (!actionTarget) return;
    const { period, action } = actionTarget;
    const newStatus = action === 'close' ? 'closed' : 'open';
    setPeriods(prev => prev.map(p => p.id === period.id ? { ...p, status: newStatus as FiscalPeriod['status'] } : p));
    toast.success(`Period "${period.name}" ${action === 'close' ? 'closed' : 'reopened'}`);
    setActionTarget(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Fiscal Periods</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage accounting periods and period closings</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setForm(emptyForm); setDialogOpen(true); }}><Plus className="h-3 w-3" /> Add Period</Button>
      </div>

      {/* Current period highlight */}
      {openPeriod && (
        <div className="surface-elevated p-5 border-l-4 border-l-success">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-success" />
                <span className="text-[10px] font-semibold text-success uppercase tracking-wide">Current Open Period</span>
              </div>
              <h3 className="text-lg font-semibold text-foreground">{openPeriod.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {openPeriod.startDate} → {openPeriod.endDate}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-foreground">{fmt(openPeriod.revenue)}</p>
              <p className="text-xs text-muted-foreground">{openPeriod.transactions.toLocaleString()} transactions</p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Period', 'Start Date', 'End Date', 'Status', 'Transactions', 'Revenue', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', ['Transactions', 'Revenue'].includes(h) ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => {
              const style = STATUS_STYLES[p.status];
              const Icon = style.icon;
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.startDate}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.endDate}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium', style.cls)}>
                      <Icon className="h-2.5 w-2.5" /> {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm">{p.transactions.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{fmt(p.revenue)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      {p.status === 'open' && (
                        <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={() => setActionTarget({ period: p, action: 'close' })}>
                          <Lock className="h-3 w-3" /> Close Period
                        </Button>
                      )}
                      {p.status === 'closed' && (
                        <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={() => setActionTarget({ period: p, action: 'reopen' })}>
                          <Unlock className="h-3 w-3" /> Reopen
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Fiscal Period</DialogTitle>
            <DialogDescription>Create a new accounting period</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Period Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. FY2026 Q3" className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate}>Create Period</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close/Reopen Confirmation */}
      <Dialog open={!!actionTarget} onOpenChange={() => setActionTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionTarget?.action === 'close' ? 'Close Period' : 'Reopen Period'}</DialogTitle>
            <DialogDescription>
              {actionTarget?.action === 'close'
                ? `Are you sure you want to close "${actionTarget?.period.name}"? No new transactions will be allowed.`
                : `Reopen "${actionTarget?.period.name}"? This will allow new transactions.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionTarget(null)}>Cancel</Button>
            <Button size="sm" variant={actionTarget?.action === 'close' ? 'default' : 'outline'} onClick={handleAction}>
              {actionTarget?.action === 'close' ? 'Close Period' : 'Reopen Period'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
