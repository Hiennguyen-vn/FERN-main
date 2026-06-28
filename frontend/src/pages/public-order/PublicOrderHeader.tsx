import { Search, UtensilsCrossed } from 'lucide-react';
import type { PublicTableView } from '@/api/fern-api';

export function PublicOrderHeader({
  table,
  tableToken,
  searchValue,
  onSearchChange,
}: {
  table: PublicTableView | undefined;
  tableToken: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
}) {
  const tableLabel = String(table?.tableName || table?.tableCode || tableToken || 'Bàn');
  const outletLabel = String(table?.outletName || table?.outletCode || '');

  return (
    <header className="po-header">
      <div className="po-header-inner">
        <div className="po-table-badge">
          <div className="po-table-icon" aria-hidden>
            <UtensilsCrossed className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{tableLabel}</p>
            {outletLabel ? (
              <p className="truncate text-xs text-slate-500">{outletLabel}</p>
            ) : null}
          </div>
        </div>
        <div className="po-search-wrap">
          <Search className="po-search-icon h-4 w-4" aria-hidden />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm món..."
            aria-label="Tìm món"
          />
        </div>
      </div>
    </header>
  );
}
