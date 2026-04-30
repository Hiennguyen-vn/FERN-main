import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCashSummary, type CashSummary } from '@/api/admin-api';

const VARIANCE_RED_THRESHOLD = 50_000;

export function CashReconPage() {
  const [sessionId, setSessionId] = useState<string>('');
  const queryId = sessionId.trim();
  const { data, isLoading, error, refetch } = useQuery<CashSummary>({
    queryKey: ['admin-cash', queryId],
    queryFn: () => fetchCashSummary(Number(queryId)),
    enabled: queryId !== '' && !Number.isNaN(Number(queryId)),
  });

  const variance = data?.variance != null ? Number(data.variance) : null;
  const varianceClass = variance == null
    ? ''
    : Math.abs(variance) > VARIANCE_RED_THRESHOLD
      ? 'text-red-600 font-semibold'
      : 'text-muted-foreground';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Cash Reconciliation</h2>
        <p className="text-xs text-muted-foreground">
          Per-session cash drawer summary. Variance &gt; {VARIANCE_RED_THRESHOLD.toLocaleString()} VND highlighted.
        </p>
      </div>

      <div className="flex gap-2 items-end">
        <label className="text-xs">
          Session ID
          <input className="block border rounded px-2 py-1 text-xs w-48"
                 value={sessionId} onChange={e => setSessionId(e.target.value)} />
        </label>
        <button className="border rounded px-3 py-1 text-xs"
                onClick={() => refetch()}>Lookup</button>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="text-xs text-red-600">{String(error)}</div>}

      {data && (
        <div className="border rounded p-4 grid grid-cols-2 gap-3 text-xs max-w-2xl">
          <div className="text-muted-foreground">Session</div><div>{data.sessionId}</div>
          <div className="text-muted-foreground">Outlet</div><div>{data.outletId}</div>
          <div className="text-muted-foreground">Open Float</div><div>{data.openFloat}</div>
          <div className="text-muted-foreground">Sales Cash</div><div>{data.salesCash}</div>
          <div className="text-muted-foreground">Paid In</div><div>{data.paidIn}</div>
          <div className="text-muted-foreground">Paid Out</div><div>{data.paidOut}</div>
          <div className="text-muted-foreground">Drops</div><div>{data.drops}</div>
          <div className="text-muted-foreground">Counted</div><div>{data.counted ?? '—'}</div>
          <div className="text-muted-foreground">Expected</div><div>{data.expectedTotal}</div>
          <div className="text-muted-foreground">Variance</div>
          <div className={varianceClass}>{data.variance ?? '—'}</div>
        </div>
      )}
    </div>
  );
}
