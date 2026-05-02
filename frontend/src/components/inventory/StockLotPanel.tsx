import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inventoryApi, type StockLotView, type CreateStockLotPayload } from '@/api/inventory-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/shell/PermissionStates';

/**
 * Days from today (local midnight) to a date-only string `YYYY-MM-DD`.
 * `new Date('2026-05-08')` is parsed as UTC, which gives wrong day-counts in non-UTC locales.
 */
function daysUntilLocal(dateOnly: string): number | null {
  if (!dateOnly) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success border-success/20',
  DEPLETED: 'bg-muted text-muted-foreground border-border',
  EXPIRED: 'bg-destructive/10 text-destructive border-destructive/20',
  RECALLED: 'bg-warning/10 text-warning border-warning/30',
};

interface Props {
  outletId?: string;
  itemId?: string;
  canEdit?: boolean;
  currencyCode?: string;
}

const EMPTY_FORM: CreateStockLotPayload = {
  itemId: '',
  locationId: '',
  batchNo: '',
  expiresAt: '',
  qtyReceived: 0,
  unitCost: 0,
  notes: '',
};

export function StockLotPanel({ outletId, itemId, canEdit, currencyCode }: Props) {
  const { token } = useShellRuntime();
  const [lots, setLots] = useState<StockLotView[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateStockLotPayload>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [submitTried, setSubmitTried] = useState(false);

  const load = () => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    inventoryApi
      .listStockLots(token, {
        locationId: outletId,
        itemId,
        status: statusFilter || undefined,
        limit: 100,
      })
      .then((rows) => { if (!cancelled) setLots(rows); })
      .catch(() => { if (!cancelled) toast.error('Failed to load stock lots'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    const cleanup = load();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, outletId, itemId, statusFilter]);

  const handleCreate = async () => {
    if (!token || !form.qtyReceived || !form.itemId || !form.locationId) {
      setSubmitTried(true);
      toast.error('Item, location và số lượng là bắt buộc');
      return;
    }
    setSaving(true);
    setSubmitTried(false);
    try {
      const lot = await inventoryApi.createStockLotRecord(token, {
        ...form,
        locationId: form.locationId || outletId || '',
        itemId: form.itemId || itemId || '',
      });
      setLots((prev) => [lot, ...prev]);
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast.success('Lot created');
    } catch {
      toast.error('Failed to create lot');
    } finally {
      setSaving(false);
    }
  };

  const expiringCount = lots.filter((l) => {
    if (!l.expiresAt || l.status !== 'ACTIVE') return false;
    const days = daysUntilLocal(l.expiresAt);
    return days != null && days <= 7;
  }).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Stock Lots (FIFO)</p>
          {expiringCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 border border-warning/30 text-warning font-medium">
              {expiringCount} hết hạn trong 7 ngày
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Tất cả</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="DEPLETED">DEPLETED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="RECALLED">RECALLED</option>
          </select>
          <button onClick={load} className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-accent">
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
          {canEdit && (
            <Button size="sm" className="h-7 text-xs px-2.5 gap-1" onClick={() => setShowForm(true)}>
              <Plus className="h-3 w-3" /> Thêm lô
            </Button>
          )}
        </div>
      </div>

      {showForm && canEdit && (
        <div className="border rounded-lg p-3 space-y-3 border-l-2 border-l-primary bg-muted/10">
          <p className="text-xs font-semibold">Nhập lô mới</p>
          <div className="grid grid-cols-2 gap-2">
            {!itemId && (
              <div>
                <Label className="text-[10px]">Item ID <span className="text-destructive">*</span></Label>
                <Input
                  className={cn('h-7 text-xs mt-0.5', submitTried && !form.itemId && 'border-destructive ring-1 ring-destructive')}
                  aria-invalid={submitTried && !form.itemId}
                  required
                  value={String(form.itemId)}
                  onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
                />
              </div>
            )}
            {!outletId && (
              <div>
                <Label className="text-[10px]">Location (Outlet ID) <span className="text-destructive">*</span></Label>
                <Input
                  className={cn('h-7 text-xs mt-0.5', submitTried && !form.locationId && 'border-destructive ring-1 ring-destructive')}
                  aria-invalid={submitTried && !form.locationId}
                  required
                  value={String(form.locationId)}
                  onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                />
              </div>
            )}
            <div>
              <Label className="text-[10px]">Batch No</Label>
              <Input className="h-7 text-xs mt-0.5" value={String(form.batchNo ?? '')} onChange={(e) => setForm((f) => ({ ...f, batchNo: e.target.value }))} />
            </div>
            <div>
              <Label className="text-[10px]">Ngày hết hạn</Label>
              <Input type="date" className="h-7 text-xs mt-0.5" value={String(form.expiresAt ?? '')} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value || null }))} />
            </div>
            <div>
              <Label className="text-[10px]">Số lượng nhập <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                min="0"
                step="0.001"
                required
                aria-invalid={submitTried && !form.qtyReceived}
                className={cn('h-7 text-xs mt-0.5', submitTried && !form.qtyReceived && 'border-destructive ring-1 ring-destructive')}
                value={form.qtyReceived}
                onChange={(e) => setForm((f) => ({ ...f, qtyReceived: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label className="text-[10px]">Đơn giá nhập</Label>
              <Input type="number" min="0" step="0.01" className="h-7 text-xs mt-0.5" value={form.unitCost ?? 0} onChange={(e) => setForm((f) => ({ ...f, unitCost: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => void handleCreate()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Lưu'}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); }}>
              Hủy
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : lots.length === 0 ? (
        <EmptyState
          title="Chưa có lô nào"
          description={statusFilter && statusFilter !== ''
            ? `Không có lô ở trạng thái ${statusFilter}. Đổi bộ lọc để xem các lô khác.`
            : 'Tạo lô đầu tiên hoặc đợi lô tự sinh khi GRN được post.'}
          action={canEdit ? { label: 'Thêm lô', onClick: () => setShowForm(true) } : undefined}
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 text-[10px]">Lô / Batch</th>
                <th className="text-left px-3 py-2 text-[10px]">Hết hạn</th>
                <th className="text-right px-3 py-2 text-[10px]">Còn lại</th>
                <th className="text-right px-3 py-2 text-[10px]">Đơn giá{currencyCode ? ` (${currencyCode})` : ''}</th>
                <th className="text-left px-3 py-2 text-[10px]">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                const daysLeft = lot.expiresAt ? daysUntilLocal(lot.expiresAt) : null;
                return (
                  <tr key={lot.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-1.5">
                      <p className="font-mono">{lot.batchNo ?? lot.lotCode ?? `#${lot.id}`}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(lot.receivedAt).toLocaleDateString('vi-VN')}</p>
                    </td>
                    <td className="px-3 py-1.5">
                      {lot.expiresAt ? (
                        <span className={cn('font-mono', daysLeft != null && daysLeft <= 7 ? 'text-warning font-medium' : '')}>
                          {new Date(lot.expiresAt).toLocaleDateString('vi-VN')}
                          {daysLeft != null && daysLeft <= 30 && <span className="ml-1 text-[10px]">({daysLeft}d)</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {Number(lot.qtyRemaining).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}
                      <span className="text-[10px] text-muted-foreground ml-0.5">
                        / {Number(lot.qtyReceived).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {Number(lot.unitCost).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn('px-1.5 py-0.5 rounded-full border text-[10px] font-medium', STATUS_CLASS[lot.status] ?? '')}>
                        {lot.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
