import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPriceDrift, type PriceDriftRow } from '@/api/admin-api';

function todayUtcStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function PriceDriftPage() {
  const [from, setFrom] = useState(todayUtcStartIso());
  const [to, setTo] = useState(nowIso());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-price-drift', from, to],
    queryFn: () => fetchPriceDrift({ from, to, limit: 500 }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Price Drift Report</h2>
        <p className="text-xs text-muted-foreground">
          Sales submitted from offline edge with stale unit_price differing from current product_price.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <label className="text-xs">
          From (ISO)
          <input className="block border rounded px-2 py-1 text-xs w-72"
                 value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="text-xs">
          To (ISO)
          <input className="block border rounded px-2 py-1 text-xs w-72"
                 value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <button
          className="border rounded px-3 py-1 text-xs"
          onClick={() => refetch()}
        >Refresh</button>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="text-xs text-red-600">{String(error)}</div>}

      <div className="border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Sale</th>
              <th className="text-left p-2">Outlet</th>
              <th className="text-left p-2">Product</th>
              <th className="text-right p-2">Paid</th>
              <th className="text-right p-2">Current</th>
              <th className="text-right p-2">Drift</th>
              <th className="text-right p-2">Qty</th>
              <th className="text-left p-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r: PriceDriftRow) => (
              <tr key={`${r.saleId}-${r.productId}`} className="border-t">
                <td className="p-2">{r.saleId}</td>
                <td className="p-2">{r.outletId}</td>
                <td className="p-2">{r.productId}</td>
                <td className="p-2 text-right">{r.unitPrice}</td>
                <td className="p-2 text-right">{r.currentPriceAtSync}</td>
                <td className="p-2 text-right font-semibold">{r.priceDriftAmount}</td>
                <td className="p-2 text-right">{r.qty}</td>
                <td className="p-2">{r.createdAt}</td>
              </tr>
            ))}
            {data && data.count === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No drift detected.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">Total: {data?.count ?? 0}</div>
    </div>
  );
}
