import { useEffect, useMemo, useState } from 'react';
import {
  Bell, X, Check, CheckCheck, Info, AlertTriangle, Zap,
  Package, ShoppingCart, Users, BarChart3, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/api/decoders';
import { auditApi, type AuditLogView } from '@/api/fern-api';
import { useAuth } from '@/auth/use-auth';

interface Notification {
  id: string;
  title: string;
  message: string;
  module: string;
  type: 'info' | 'warning' | 'action' | 'success';
  isRead: boolean;
  createdAt: string;
}

const MODULE_ICONS: Record<string, React.ElementType> = {
  pos: ShoppingCart, inventory: Package, procurement: ShoppingCart,
  hr: Users, reports: BarChart3, system: Zap, finance: Clock,
};

const TYPE_STYLES: Record<string, { icon: React.ElementType; cls: string }> = {
  info: { icon: Info, cls: 'text-primary bg-primary/10' },
  warning: { icon: AlertTriangle, cls: 'text-warning bg-warning/10' },
  action: { icon: Zap, cls: 'text-accent-foreground bg-accent' },
  success: { icon: Check, cls: 'text-success bg-success/10' },
};

function toTitleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function deriveModule(log: AuditLogView) {
  const text = `${log.action ?? ''} ${log.entityName ?? ''}`.toLowerCase();
  if (text.includes('inventory') || text.includes('stock')) return 'inventory';
  if (text.includes('procurement') || text.includes('purchase') || text.includes('invoice') || text.includes('supplier')) return 'procurement';
  if (text.includes('payroll') || text.includes('shift') || text.includes('attendance') || text.includes('contract')) return 'hr';
  if (text.includes('finance') || text.includes('expense')) return 'finance';
  if (text.includes('sales') || text.includes('order') || text.includes('promotion') || text.includes('pos')) return 'pos';
  if (text.includes('report')) return 'reports';
  return 'system';
}

function deriveType(log: AuditLogView): Notification['type'] {
  const action = String(log.action ?? '').toLowerCase();
  if (/(fail|error|reject|deny|revoke|cancel|blocked)/.test(action)) return 'warning';
  if (/(approve|create|post|done|complete|success)/.test(action)) return 'success';
  if (/(pending|required|review)/.test(action)) return 'action';
  return 'info';
}

function mapAuditToNotification(log: AuditLogView): Notification {
  const action = String(log.action ?? 'event');
  const entityName = String(log.entityName ?? '').trim();
  const entityId = String(log.entityId ?? '').trim();
  const actor = log.actorUserId != null ? String(log.actorUserId) : 'unknown';
  const correlation = log.correlationId ? ` · corr ${String(log.correlationId)}` : '';
  const scopeTarget = [entityName, entityId].filter(Boolean).join(' #');

  return {
    id: String(log.id ?? `${action}-${log.createdAt ?? Date.now()}`),
    title: toTitleCase(action),
    message: scopeTarget
      ? `${scopeTarget} by user ${actor}${correlation}`
      : `User ${actor}${correlation}`,
    module: deriveModule(log),
    type: deriveType(log),
    isRead: false,
    createdAt: String(log.createdAt ?? new Date().toISOString()),
  };
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type FilterType = 'all' | 'unread' | 'action' | 'warning';

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const { session } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const page = await auditApi.logs(session.accessToken, { limit: 50, offset: 0 });
        if (cancelled) return;
        const mapped = (page.items || [])
          .map(mapAuditToNotification)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setNotifications((prev) => {
          const previousReadState = new Map(prev.map((item) => [item.id, item.isRead]));
          return mapped.map((item) => ({
            ...item,
            isRead: previousReadState.get(item.id) ?? false,
          }));
        });
      } catch (error) {
        console.error('Notification feed load failed:', error);
        if (!cancelled) {
          setNotifications([]);
          setLoadError(getErrorMessage(error, 'Notification feed is not available from backend.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const filtered = useMemo(() => notifications.filter(n => {
    if (filter === 'unread') return !n.isRead;
    if (filter === 'action') return n.type === 'action';
    if (filter === 'warning') return n.type === 'warning';
    return true;
  }), [filter, notifications]);

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  const toggleRead = (id: string) => setNotifications(prev =>
    prev.map(n => n.id === id ? { ...n, isRead: !n.isRead } : n)
  );

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-foreground/20 z-40" onClick={onClose} />
      <div className="fixed right-4 top-16 w-[380px] max-h-[70vh] bg-card rounded-xl border shadow-surface-xl z-50 animate-fade-in flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
              {unreadCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground font-medium">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={markAllRead}>
                  <CheckCheck className="h-3 w-3" /> Mark all read
                </Button>
              )}
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1 mt-3">
            {([
              { key: 'all' as FilterType, label: 'All' },
              { key: 'unread' as FilterType, label: `Unread (${unreadCount})` },
              { key: 'action' as FilterType, label: 'Actions' },
              { key: 'warning' as FilterType, label: 'Warnings' },
            ]).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'text-[10px] px-2 py-1 rounded-md transition-colors',
                  filter === f.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Loading notifications...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{loadError || 'No notifications'}</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(n => {
                const typeStyle = TYPE_STYLES[n.type] || TYPE_STYLES.info;
                const TypeIcon = typeStyle.icon;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer relative',
                      !n.isRead && 'bg-primary/[0.02]'
                    )}
                    onClick={() => toggleRead(n.id)}
                  >
                    {!n.isRead && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                    <div className="flex gap-3">
                      <div className={cn('h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5', typeStyle.cls)}>
                        <TypeIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('text-xs font-medium truncate', n.isRead ? 'text-muted-foreground' : 'text-foreground')}>
                            {n.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">
                            {timeAgo(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mt-1 inline-block">
                          {n.module}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
