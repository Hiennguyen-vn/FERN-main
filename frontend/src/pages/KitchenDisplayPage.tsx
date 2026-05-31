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
import {
  AlertTriangle,
  ChefHat,
  Clock,
  ListChecks,
  RefreshCw,
  TimerReset,
  Utensils,
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
              return [...prev, msg.ticket!].sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
    () => [...tickets].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
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
      <div className="min-h-[calc(100vh-4rem)] bg-zinc-950 text-zinc-50 p-8">
        <div className="max-w-xl">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400 text-zinc-950">
            <ChefHat className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Kitchen Display</h1>
          <p className="mt-2 text-zinc-400">
            Chọn một outlet cụ thể để xem ticket bếp.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-950 text-zinc-50">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-zinc-950">
              <ChefHat className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">Kitchen Display</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                <span className="truncate">{outletLabel}</span>
                <span className="hidden sm:inline">•</span>
                <span>{new Date(now).toLocaleTimeString('vi-VN', { hour12: false })}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <FilterButton active={filter === 'all'} label="Tất cả" count={ticketCounts.all} onClick={() => setFilter('all')} />
            <FilterButton active={filter === 'new'} label="Mới" count={ticketCounts.new} onClick={() => setFilter('new')} />
            <FilterButton active={filter === 'in_progress'} label="Đang làm" count={ticketCounts.in_progress} onClick={() => setFilter('in_progress')} />
            <FilterButton active={filter === 'ready'} label="Sẵn sàng" count={ticketCounts.ready} onClick={() => setFilter('ready')} />
            <button
              type="button"
              onClick={() => void hydrate()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-medium text-zinc-300 transition hover:border-white/25 hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" />
              Sync
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 gap-5 p-5 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">All day</div>
                <div className="mt-1 text-sm text-zinc-400">Tổng món đang cần bếp xử lý</div>
              </div>
              <ListChecks className="h-5 w-5 text-zinc-500" />
            </div>
            <div className="mt-4 space-y-2">
              {allDayItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-zinc-500">
                  Chưa có món trong hàng đợi.
                </div>
              ) : (
                allDayItems.slice(0, 10).map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 border-b border-white/10 py-2 last:border-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{item.name}</div>
                      <div className="text-xs text-zinc-500">{item.ready > 0 ? `${item.ready} sẵn sàng` : `${item.active} đang làm`}</div>
                    </div>
                    <div className="text-2xl font-semibold tabular-nums text-amber-300">x{item.qty}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <TimerReset className="h-4 w-4 text-amber-300" />
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
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {visibleTickets.length === 0 ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
          <Utensils className="h-12 w-12 text-zinc-600" />
          <h2 className="mt-4 text-xl font-semibold text-zinc-100">Không có ticket trong hàng này</h2>
          <p className="mt-2 max-w-md text-sm text-zinc-500">
            Khi POS gửi order mới, ticket sẽ xuất hiện theo thứ tự cũ nhất trước.
          </p>
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
      className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
        active
          ? 'bg-amber-400 text-zinc-950'
          : 'border border-white/10 text-zinc-300 hover:border-white/25 hover:bg-white/10'
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
        active ? 'bg-black/15' : 'bg-white/10 text-zinc-300'
      }`}>
        {count}
      </span>
    </button>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-2 py-3">
      <div className="text-2xl font-semibold tabular-nums text-zinc-50">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
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
    ? 'bg-red-500 text-white'
    : tone === 'warning'
      ? 'bg-amber-400 text-zinc-950'
      : ticket.status === 'ready'
        ? 'bg-emerald-400 text-emerald-950'
        : 'bg-zinc-100 text-zinc-950';

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-zinc-100 text-zinc-950 shadow-2xl shadow-black/20 ${
        tone === 'breached' ? 'border-red-400' : 'border-white/10'
      }`}
    >
      <header className={`${headerClass} px-4 py-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-black/15 px-2 py-0.5 text-xs font-bold tabular-nums">#{index + 1}</span>
              <span className="truncate text-xl font-black tracking-tight">{ticketTitle(ticket)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-80">
              <span>{orderTypeLabel(ticket.orderType)}</span>
              <span>•</span>
              <span>{statusLabel(ticket.status)}</span>
              <span>•</span>
              <span>{itemCount} món</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1 text-2xl font-black tabular-nums">
              <Clock className="h-5 w-5" />
              {formatMinutes(elapsed)}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
              Thời gian chờ
            </div>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/15">
          <div
            className={`h-full rounded-full ${tone === 'breached' ? 'bg-white' : 'bg-zinc-950/70'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <div className="divide-y divide-zinc-200">
        {ticket.items.map((item) => {
          const next = nextItemAction(item.status);
          const isReady = item.status === 'ready' || item.status === 'served';
          return (
            <div key={item.id} className={`grid grid-cols-[1fr_auto] gap-3 px-4 py-3 ${isReady ? 'bg-emerald-50' : 'bg-white'}`}>
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-9 min-w-9 items-center justify-center rounded-lg text-lg font-black tabular-nums ${
                    isReady ? 'bg-emerald-500 text-white' : 'bg-zinc-950 text-white'
                  }`}>
                    x{item.qty}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <div className="text-lg font-bold leading-tight">{item.productName}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                        item.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : item.status === 'preparing'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-zinc-200 text-zinc-700'
                      }`}>
                        {statusLabel(item.status)}
                      </span>
                    </div>

                    {item.modifiers?.entries && item.modifiers.entries.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.modifiers.entries.map((m, i) => (
                          <span key={i} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                            {m.name}{m.value ? `: ${m.value}` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.allergens && item.allergens.length > 0 && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {item.allergens.join(', ')}
                      </div>
                    )}

                    {item.notes && (
                      <div className="mt-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-2 text-sm font-medium italic text-zinc-700">
                        {item.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {next ? (
                <button
                  type="button"
                  onClick={() => onAdvanceItem(ticket.id, item)}
                  className={`h-12 min-w-[112px] rounded-xl px-4 text-sm font-black uppercase tracking-wide transition active:scale-[0.98] ${
                    next === 'ready'
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : next === 'served'
                        ? 'bg-zinc-950 text-white hover:bg-zinc-800'
                        : 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
                  }`}
                >
                  {actionLabel(next)}
                </button>
              ) : (
                <div className="flex h-12 min-w-[112px] items-center justify-center rounded-xl bg-zinc-100 text-xs font-bold uppercase text-zinc-400">
                  Done
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="flex items-center justify-between gap-3 bg-zinc-200 px-4 py-3">
        <div className="text-sm font-semibold text-zinc-700">
          {readyCount}/{itemCount} món ready
        </div>
        <button
          type="button"
          onClick={() => onCancelTicket(ticket.id)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-red-700 transition hover:bg-red-100"
        >
          <X className="h-3.5 w-3.5" />
          Hủy
        </button>
      </footer>
    </article>
  );
}
