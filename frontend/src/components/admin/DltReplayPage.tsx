import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchDltPending, replayDlt, type DltRow } from '@/api/admin-api';

export function DltReplayPage() {
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-dlt'],
    queryFn: () => fetchDltPending(200),
  });

  const replay = useMutation({
    mutationFn: (id: number) => replayDlt(id),
    onSettled: () => {
      setPendingId(null);
      qc.invalidateQueries({ queryKey: ['admin-dlt'] });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Failed Sync Queue (DLT)</h2>
        <p className="text-xs text-muted-foreground">
          Outbox events that exhausted retries. Replay re-queues them as PENDING with attempt_count = 0.
        </p>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="text-xs text-red-600">{String(error)}</div>}

      <div className="border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Aggregate</th>
              <th className="text-left p-2">Topic</th>
              <th className="text-right p-2">Attempts</th>
              <th className="text-left p-2">Last Error</th>
              <th className="text-left p-2">Created</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r: DltRow) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-mono">{r.id}</td>
                <td className="p-2">{r.aggregateType}/{r.aggregateId}</td>
                <td className="p-2">{r.topic}</td>
                <td className="p-2 text-right">{r.attempts}</td>
                <td className="p-2 max-w-md truncate" title={r.lastError ?? ''}>{r.lastError}</td>
                <td className="p-2">{r.createdAt}</td>
                <td className="p-2">
                  <button
                    disabled={pendingId === r.id || replay.isPending}
                    className="border rounded px-2 py-0.5 text-xs disabled:opacity-50"
                    onClick={() => { setPendingId(r.id); replay.mutate(r.id); }}
                  >
                    {pendingId === r.id ? '…' : 'Replay'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.count === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">DLT empty.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">Total: {data?.count ?? 0}</div>
    </div>
  );
}
