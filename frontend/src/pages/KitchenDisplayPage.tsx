import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSONbig from 'json-bigint';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import {
  kitchenApi,
  type KitchenItemStatus,
  type KitchenTicket,
  type KitchenTicketItem,
  type KitchenTicketStatus,
} from '@/api/kitchen-api';
import { Button } from '@/components/ui/button';
import { ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ChefHat,
  Clock,
  ListChecks,
  RefreshCw,
  TimerReset,
  Utensils,
  Wifi,
  X,
} from 'lucide-react';

const REFRESH_HYDRATE_MS = 30_000;
const wsJsonParser = JSONbig({ storeAsString: true, useNativeBigInt: false });

function nextItemAction(status: KitchenItemStatus): KitchenItemStatus | null {
  switch (status) {
    case 'new': return 'preparing';
    case 'preparing': return 'ready';
    case 'ready': return 'served';
    default: return null;
  }
}

function actionLabel(next: KitchenItemStatus): string {
  switch (next) {
    case 'preparing': return 'Bắt đầu';
    case 'ready':     return 'Sẵn sàng';
    case 'served':    return 'Đã phục vụ';
    default:          return next;
  }
}

type TicketFilter = 'all' | 'new' | 'in_progress' | 'ready';

function statusLabel(status: KitchenTicketStatus | KitchenItemStatus): string {
  switch (status) {
    case 'new': return 'Mới';
    case 'in_progress': return 'Đang làm';
    case 'preparing': return 'Đang làm';
    case 'ready': return 'Sẵn sàng';
    case 'served': return 'Đã phục vụ';
    case 'cancelled': return 'Đã hủy';
    default: return status;
  }
}

function orderTypeLabel(orderType?: string | null): string {
  if (orderType === 'dine_in') return 'Tại quầy';
  if (orderType === 'takeaway') return 'Mang đi';
  if (orderType === 'delivery') return 'Giao hàng';
  return 'Order';
}

function elapsedSeconds(fromIso: string, now: number): number {
  const start = new Date(fromIso).getTime();
  return Math.max(0, Math.floor((now - start) / 1000));
}

// Earliest Deadline First: deadline = createdAt + prepSlaSeconds. Mirrors the backend policy
// (KitchenScheduling.earliestDeadlineFirst) so client-inserted tickets keep the same ordering.
function deadlineMs(ticket: KitchenTicket): number {
  const created = new Date(ticket.createdAt).getTime();
  const sla = Number(ticket.prepSlaSeconds || 0);
  return created + Math.max(0, sla) * 1000;
}

function byEarliestDeadline(a: KitchenTicket, b: KitchenTicket): number {
  const d = deadlineMs(a) - deadlineMs(b);
  if (d !== 0) return d;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ticketAgeTone(ticket: KitchenTicket, now: number): 'breached' | 'warning' | 'normal' {
  if (ticket.slaBreached) return 'breached';
  const sla = Number(ticket.prepSlaSeconds || 0);
  if (sla <= 0) return 'normal';
  const ratio = elapsedSeconds(ticket.createdAt, now) / sla;
  if (ratio >= 1) return 'breached';
  if (ratio >= 0.75) return 'warning';
  return 'normal';
}

function ticketTitle(ticket: KitchenTicket): string {
  return ticket.orderingTableName
    ?? ticket.orderingTableCode
    ?? `Sale #${String(ticket.saleId).slice(-6)}`;
}

function itemQty(item: KitchenTicketItem): number {
  const qty = Number(item.qty);
  return Number.isFinite(qty) ? qty : 0;
}

export default function KitchenDisplayPage() {
  const { token, scope } = useShellRuntime();
  const outletId = scope.level === 'outlet' ? scope.outletId ?? null : null;
  const outletLabel = scope.outletName ?? outletId;

  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<TicketFilter>('all');
  const wsRef = useRef<WebSocket | null>(null);

  const hydrate = useCallback(async () => {
    if (!token || !outletId) return;
    try {
      const resp = await kitchenApi.listTickets(token, outletId);
      setTickets(resp.tickets ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, outletId]);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(hydrate, REFRESH_HYDRATE_MS);
    return () => clearInterval(interval);
  }, [hydrate]);

  useEffect(() => {
    if (!token || !outletId) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const connect = () => {
      if (cancelled) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${scheme}://${window.location.host}/ws/sync/${outletId}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = wsJsonParser.parse(event.data as string) as {
            type: string;
            ticket?: KitchenTicket;
            ticketId?: string;
          };
          if (msg.type === 'kitchen.ticket.created' && msg.ticket) {
            setTickets((prev) => {
              if (prev.some((t) => t.id === msg.ticket!.id)) return prev;
              return [...prev, msg.ticket!].sort(byEarliestDeadline);
            });
          } else if (msg.type === 'kitchen.ticket.updated' && msg.ticket) {
            const updated = msg.ticket;
            setTickets((prev) => {
              if (updated.status === 'served' || updated.status === 'cancelled') {
                return prev.filter((t) => t.id !== updated.id);
              }
              const i = prev.findIndex((t) => t.id === updated.id);
              if (i < 0) return [...prev, updated];
              const copy = prev.slice();
              copy[i] = updated;
              return copy;
            });
          } else if (msg.type === 'kitchen.sla.breached' && msg.ticketId != null) {
            setTickets((prev) => prev.map((t) =>
              t.id === msg.ticketId ? { ...t, slaBreached: true } : t));
          }
        } catch {
          // ignore non-JSON or unrelated sync frames
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        retryTimer = window.setTimeout(connect, 3_000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, outletId]);

  const advanceItem = useCallback(async (ticketId: string, item: KitchenTicketItem) => {
    const next = nextItemAction(item.status);
    if (!next || !token) return;
    try {
      const updated = await kitchenApi.advanceItemStatus(token, ticketId, item.id, next);
      setError(null);
      setTickets((prev) => {
        if (updated.status === 'served' || updated.status === 'cancelled') {
          return prev.filter((t) => t.id !== updated.id);
        }
        const i = prev.findIndex((t) => t.id === updated.id);
        if (i < 0) return [...prev, updated];
        const copy = prev.slice();
        copy[i] = updated;
        return copy;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  const cancelTicket = useCallback(async (ticketId: string) => {
    if (!token) return;
    try {
      const updated = await kitchenApi.setTicketStatus(token, ticketId, 'cancelled');
      setError(null);
      setTickets((prev) => prev.filter((t) => t.id !== updated.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  const sortedTickets = useMemo(
    () => [...tickets].sort(byEarliestDeadline),
    [tickets],
  );

  const ticketCounts = useMemo(() => {
    const counts: Record<TicketFilter, number> = {
      all: sortedTickets.length,
      new: 0,
      in_progress: 0,
      ready: 0,
    };
    for (const ticket of sortedTickets) {
      if (ticket.status === 'new') counts.new += 1;
      if (ticket.status === 'in_progress') counts.in_progress += 1;
      if (ticket.status === 'ready') counts.ready += 1;
    }
    return counts;
  }, [sortedTickets]);

  const visibleTickets = useMemo(() => {
    if (filter === 'all') return sortedTickets;
    return sortedTickets.filter((ticket) => ticket.status === filter);
  }, [filter, sortedTickets]);

  const allDayItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; ready: number; active: number }>();
    for (const ticket of sortedTickets) {
      for (const item of ticket.items) {
        if (item.status === 'served' || item.status === 'cancelled') continue;
        const current = map.get(item.productName) ?? { name: item.productName, qty: 0, ready: 0, active: 0 };
        const qty = itemQty(item);
        current.qty += qty;
        if (item.status === 'ready') current.ready += qty;
        else current.active += qty;
        map.set(item.productName, current);
      }
    }
    return [...map.values()].sort((a, b) => b.active - a.active || b.qty - a.qty || a.name.localeCompare(b.name));
  }, [sortedTickets]);

  if (!outletId) {
    return (
      <ServiceUnavailablePage
        state="scope_mismatch"
        moduleName="Kitchen Display"
      />
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ChefHat className="h-4 w-4" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Kitchen Display</h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <span className="scope-chip scope-chip-outlet">{outletLabel}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(now).toLocaleTimeString('vi-VN', { hour12: false })}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-success">
              <Wifi className="h-3 w-3" /> Live
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterButton active={filter === 'all'} label="Tất cả" count={ticketCounts.all} onClick={() => setFilter('all')} />
          <FilterButton active={filter === 'new'} label="Mới" count={ticketCounts.new} onClick={() => setFilter('new')} />
          <FilterButton active={filter === 'in_progress'} label="Đang làm" count={ticketCounts.in_progress} onClick={() => setFilter('in_progress')} />
          <FilterButton active={filter === 'ready'} label="Sẵn sàng" count={ticketCounts.ready} onClick={() => setFilter('ready')} />
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => void hydrate()}>
            <RefreshCw className="h-3 w-3" />
            Sync
          </Button>
        </div>
      </div>

      {error && (
        <div className="permission-banner permission-banner-unavailable animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">Không thể đồng bộ ticket bếp</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="surface-elevated p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-primary">All day</div>
                <div className="mt-1 text-sm text-muted-foreground">Tổng món đang cần bếp xử lý</div>
              </div>
              <ListChecks className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-4 space-y-2">
              {allDayItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  Chưa có món trong hàng đợi.
                </div>
              ) : (
                allDayItems.slice(0, 10).map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.ready > 0 ? `${item.ready} sẵn sàng` : `${item.active} đang làm`}</div>
                    </div>
                    <div className="text-xl font-semibold tabular-nums text-primary">x{item.qty}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="surface-elevated p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TimerReset className="h-4 w-4 text-primary" />
              Service pace
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Metric value={ticketCounts.new} label="Mới" />
              <Metric value={ticketCounts.in_progress} label="Đang làm" />
              <Metric value={ticketCounts.ready} label="Ready" />
            </div>
          </section>
        </aside>

        <main className="min-w-0">
          {visibleTickets.length === 0 ? (
            <div className="surface-elevated flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
              <Utensils className="h-10 w-10 text-muted-foreground/60" />
              <h3 className="mt-4 text-sm font-semibold text-foreground">Không có ticket trong hàng này</h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visibleTickets.map((ticket, index) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  index={index}
                  now={now}
                  onAdvanceItem={advanceItem}
                  onCancelTicket={cancelTicket}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className={cn(
        'rounded px-1.5 py-0.5 text-[10px] tabular-nums',
        active ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground',
      )}>
        {count}
      </span>
    </button>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-3">
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function TicketCard({
  ticket,
  index,
  now,
  onAdvanceItem,
  onCancelTicket,
}: {
  ticket: KitchenTicket;
  index: number;
  now: number;
  onAdvanceItem: (ticketId: string, item: KitchenTicketItem) => void;
  onCancelTicket: (ticketId: string) => void;
}) {
  const tone = ticketAgeTone(ticket, now);
  const elapsed = elapsedSeconds(ticket.createdAt, now);
  const sla = Number(ticket.prepSlaSeconds || 0);
  const progress = sla > 0 ? Math.min(100, Math.round((elapsed / sla) * 100)) : 0;
  const readyCount = ticket.items.filter((item) => item.status === 'ready' || item.status === 'served').length;
  const itemCount = ticket.items.length;

  const headerClass = tone === 'breached'
    ? 'bg-destructive text-destructive-foreground'
    : tone === 'warning'
      ? 'bg-warning text-warning-foreground'
      : ticket.status === 'ready'
        ? 'bg-success text-success-foreground'
        : 'bg-primary text-primary-foreground';

  return (
    <article
      className={cn(
        'surface-elevated overflow-hidden',
        tone === 'breached' && 'border-destructive/40',
      )}
    >
      <header className={cn('px-4 py-3', headerClass)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-black/10 px-2 py-0.5 text-xs font-bold tabular-nums">#{index + 1}</span>
              <span className="truncate text-lg font-semibold tracking-tight">{ticketTitle(ticket)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide opacity-90">
              <span>{orderTypeLabel(ticket.orderType)}</span>
              <span>•</span>
              <span>{statusLabel(ticket.status)}</span>
              <span>•</span>
              <span>{itemCount} món</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1 text-xl font-semibold tabular-nums">
              <Clock className="h-4 w-4" />
              {formatMinutes(elapsed)}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">
              Thời gian chờ
            </div>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-current opacity-70"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="divide-y divide-border">
        {ticket.items.map((item) => {
          const next = nextItemAction(item.status);
          const isReady = item.status === 'ready' || item.status === 'served';
          return (
            <div
              key={item.id}
              className={cn(
                'grid grid-cols-[1fr_auto] gap-3 px-4 py-3',
                isReady ? 'bg-success/5' : 'bg-card',
              )}
            >
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'mt-0.5 flex h-8 min-w-8 items-center justify-center rounded-md text-sm font-bold tabular-nums',
                    isReady ? 'bg-success text-success-foreground' : 'bg-primary text-primary-foreground',
                  )}>
                    x{item.qty}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <div className="text-sm font-semibold leading-tight text-foreground">{item.productName}</div>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        item.status === 'ready'
                          ? 'bg-success/10 text-success'
                          : item.status === 'preparing'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-muted text-muted-foreground',
                      )}>
                        {statusLabel(item.status)}
                      </span>
                    </div>

                    {item.modifiers?.entries && item.modifiers.entries.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.modifiers.entries.map((m, i) => (
                          <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {m.name}{m.value ? `: ${m.value}` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.allergens && item.allergens.length > 0 && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {item.allergens.join(', ')}
                      </div>
                    )}

                    {item.notes && (
                      <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/40 px-2.5 py-2 text-sm italic text-foreground">
                        {item.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {next ? (
                <Button
                  type="button"
                  size="sm"
                  variant={next === 'ready' ? 'default' : next === 'served' ? 'secondary' : 'default'}
                  className={cn(
                    'h-9 min-w-[100px] text-xs font-semibold uppercase tracking-wide',
                    next === 'ready' && 'bg-success hover:bg-success/90 text-success-foreground',
                    next === 'preparing' && 'bg-primary hover:bg-primary/90',
                  )}
                  onClick={() => onAdvanceItem(ticket.id, item)}
                >
                  {actionLabel(next)}
                </Button>
              ) : (
                <div className="flex h-9 min-w-[100px] items-center justify-center rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground">
                  Done
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3">
        <div className="text-xs font-medium text-muted-foreground">
          {readyCount}/{itemCount} món ready
        </div>
        <button
          type="button"
          onClick={() => onCancelTicket(ticket.id)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="h-3.5 w-3.5" />
          Hủy
        </button>
      </footer>
    </article>
  );
}
