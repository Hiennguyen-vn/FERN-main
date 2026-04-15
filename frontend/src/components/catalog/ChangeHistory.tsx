import { useCallback, useEffect, useState } from 'react';
import {
  History, RefreshCw, Loader2, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productApi, type AuditLogView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';

interface ChangeHistoryProps {
  token: string;
}

const ENTITY_TYPES = ['', 'product', 'recipe', 'price', 'availability', 'menu_assignment', 'publish_version'];
const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700',
  update: 'bg-blue-50 text-blue-700',
  delete: 'bg-rose-50 text-rose-700',
  publish: 'bg-violet-50 text-violet-700',
  rollback: 'bg-amber-50 text-amber-700',
  status_change: 'bg-sky-50 text-sky-700',
};

export function ChangeHistory({ token }: ChangeHistoryProps) {
  const [entries, setEntries] = useState<AuditLogView[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityType, setEntityType] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await productApi.auditLog(token, {
        entityType: entityType || undefined,
        limit,
        offset,
      });
      setEntries(data);
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load audit log'));
    } finally {
      setLoading(false);
    }
  }, [token, entityType, limit, offset]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Change History
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Catalog mutation audit trail · {entries.length} entries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={entityType} onChange={e => { setEntityType(e.target.value); setOffset(0); }}>
              <option value="">All entities</option>
              {ENTITY_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={() => void load()} disabled={loading} className="h-8 w-8 rounded border flex items-center justify-center hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No audit entries found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Time</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Action</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Entity</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Field</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">Old</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">New</th>
                <th className="text-left text-[11px] px-4 py-2.5 font-medium">User</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={String(entry.id)} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium',
                      ACTION_STYLES[entry.action] || 'bg-muted text-muted-foreground')}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-xs">{entry.entityType}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{entry.entityId}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{entry.fieldName || '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-rose-600">{entry.oldValue || '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-emerald-600">{entry.newValue || '—'}</td>
                  <td className="px-4 py-2.5 text-[10px] text-muted-foreground">{entry.username || entry.userId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">Showing {offset + 1}–{offset + entries.length}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            className="h-7 px-2 rounded border text-[10px] disabled:opacity-40">Prev</button>
          <button onClick={() => setOffset(offset + limit)} disabled={entries.length < limit}
            className="h-7 px-2 rounded border text-[10px] disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
