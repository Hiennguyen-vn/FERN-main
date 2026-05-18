import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSONbig from 'json-bigint';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import {
  kitchenApi,
  type KitchenItemStatus,
  type KitchenTicket,
  type KitchenTicketItem,
} from '@/api/kitchen-api';

const REFRESH_HYDRATE_MS = 30_000;
const wsJsonParser = JSONbig({ storeAsString: true, useNativeBigInt: false });

function formatElapsed(fromIso: string, now: number): string {
  const start = new Date(fromIso).getTime();
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

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

export default function KitchenDisplayPage() {
  const { token, scope } = useShellRuntime();
  const outletId = scope.level === 'outlet' ? scope.outletId ?? null : null;
  const outletLabel = scope.outletName ? `${scope.outletName} (${outletId})` : outletId;

  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
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

  if (!outletId) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Kitchen Display</h1>
        <p className="text-muted-foreground mt-2">
          Chọn một outlet cụ thể để xem ticket bếp.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Kitchen Display — {outletLabel}</h1>
        <div className="text-sm text-muted-foreground">
          {sortedTickets.length} ticket đang xử lý
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {sortedTickets.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-muted-foreground">
          Không có ticket nào. Khi có order mới sẽ hiển thị ở đây.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedTickets.map((ticket) => (
            <article
              key={ticket.id}
              className={`rounded-lg border p-4 shadow-sm bg-white ${
                ticket.slaBreached ? 'border-red-500 border-2' : 'border-gray-200'
              }`}
            >
              <header className="mb-3 flex items-baseline justify-between">
                <div>
                  <div className="font-semibold">
                    {ticket.orderingTableName ?? ticket.orderingTableCode ?? `Sale #${ticket.saleId}`}
                  </div>
                  <div className="text-xs uppercase text-muted-foreground">
                    {ticket.orderType ?? 'order'} • {ticket.status}
                  </div>
                </div>
                <div className={`text-sm font-mono ${ticket.slaBreached ? 'text-red-600 font-bold' : ''}`}>
                  {formatElapsed(ticket.createdAt, now)}
                </div>
              </header>
              <ul className="space-y-2">
                {ticket.items.map((item) => {
                  const next = nextItemAction(item.status);
                  return (
                    <li key={item.id} className="flex items-start justify-between border-t pt-2 first:border-t-0 first:pt-0">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-sm">×{item.qty}</span>
                          <span className="font-medium">{item.productName}</span>
                          <span className={`text-xs uppercase ${
                            item.status === 'ready' ? 'text-green-600'
                            : item.status === 'preparing' ? 'text-amber-600'
                            : 'text-muted-foreground'
                          }`}>{item.status}</span>
                        </div>
                        {item.modifiers?.entries && item.modifiers.entries.length > 0 && (
                          <div className="text-xs text-muted-foreground pl-6">
                            {item.modifiers.entries.map((m, i) => (
                              <span key={i} className="mr-2">
                                {m.name}{m.value ? `: ${m.value}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.allergens && item.allergens.length > 0 && (
                          <div className="text-xs text-red-600 pl-6">
                            ⚠ {item.allergens.join(', ')}
                          </div>
                        )}
                        {item.notes && (
                          <div className="text-xs italic text-muted-foreground pl-6">
                            {item.notes}
                          </div>
                        )}
                      </div>
                      {next && (
                        <button
                          type="button"
                          onClick={() => advanceItem(ticket.id, item)}
                          className="ml-2 text-sm rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
                        >
                          {actionLabel(next)}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <footer className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => cancelTicket(ticket.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Hủy ticket
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
