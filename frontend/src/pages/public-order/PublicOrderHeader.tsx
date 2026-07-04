import { Store, UtensilsCrossed } from 'lucide-react';
import type { PublicOrderReceiptView } from '@/api/fern-api';

type TableMeta = {
  outletName?: string | null;
  outletCode?: string | null;
  tableName?: string | null;
  tableCode?: string | null;
};

export function PublicOrderHeader({
  activeReceipt,
  tableQueryData,
  tableToken,
}: {
  activeReceipt: PublicOrderReceiptView | null;
  tableQueryData?: TableMeta | null;
  tableToken: string;
}) {
  const outletName = String(
    activeReceipt?.outletName
    || activeReceipt?.outletCode
    || tableQueryData?.outletName
    || tableQueryData?.outletCode
    || 'Loading outlet…',
  );
  const tableName = String(
    activeReceipt?.tableName
    || activeReceipt?.tableCode
    || tableQueryData?.tableName
    || tableQueryData?.tableCode
    || tableToken
    || '—',
  );

  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-slate-200/80 bg-[hsl(var(--pos-bg))]/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]">
            <Store className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{outletName}</p>
            <p className="text-xs text-slate-500">Order from your table · Pay at counter</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[hsl(var(--pos-accent)/0.25)] bg-[hsl(var(--pos-accent-soft))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--pos-accent))]">
          <UtensilsCrossed className="h-3.5 w-3.5" />
          {tableName}
        </span>
      </div>
    </header>
  );
}
