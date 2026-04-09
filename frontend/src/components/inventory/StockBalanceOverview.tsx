import { useState, useMemo } from 'react';
import {
  Search, Package, AlertTriangle, XCircle, ArrowDownRight, ArrowUpRight,
  Filter, Info,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { StockStatus } from '@/types/inventory';
import { mockStockBalances, INGREDIENT_CATEGORIES, TRANSACTION_TYPE_LABELS } from '@/data/mock-inventory';

const STATUS_CONFIG: Record<StockStatus, { label: string; class: string }> = {
  normal: { label: 'Normal', class: 'bg-success/10 text-success' },
  low: { label: 'Low Stock', class: 'bg-warning/10 text-warning' },
  out_of_stock: { label: 'Out of Stock', class: 'bg-destructive/10 text-destructive' },
  overstock: { label: 'Overstock', class: 'bg-info/10 text-info' },
};

export function StockBalanceOverview() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);

  const data = mockStockBalances;
  const totalItems = data.length;
  const lowItems = data.filter(b => b.status === 'low').length;
  const oosItems = data.filter(b => b.status === 'out_of_stock').length;

  const filtered = useMemo(() => {
    return data.filter(b => {
      if (category !== 'All' && b.category !== category) return false;
      if (lowOnly && b.status !== 'low' && b.status !== 'out_of_stock') return false;
      if (search && !b.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, search, category, lowOnly]);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Stock Balances</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Derived from ledger transactions — not directly editable</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Ingredients', value: totalItems, icon: Package, color: 'text-foreground' },
          { label: 'Low Stock', value: lowItems, icon: AlertTriangle, color: lowItems > 0 ? 'text-warning' : 'text-foreground' },
          { label: 'Out of Stock', value: oosItems, icon: XCircle, color: oosItems > 0 ? 'text-destructive' : 'text-foreground' },
          { label: 'Inbound Today', value: 3, icon: ArrowDownRight, color: 'text-success' },
          { label: 'Outbound Today', value: 7, icon: ArrowUpRight, color: 'text-muted-foreground' },
        ].map(kpi => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Derived notice */}
      <div className="flex items-start gap-2 p-3 rounded-md bg-info/5 border border-info/10">
        <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-info leading-relaxed">
          Stock balances are computed from the inventory ledger (goods receipts, sales, adjustments, waste). To correct stock, create an adjustment or stock count.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search ingredients…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {INGREDIENT_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors',
                category === cat ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-accent border-border'
              )}>{cat}</button>
          ))}
        </div>
        <button
          onClick={() => setLowOnly(!lowOnly)}
          className={cn('text-[11px] px-2.5 py-1.5 rounded-md border whitespace-nowrap transition-colors flex items-center gap-1',
            lowOnly ? 'bg-warning/10 text-warning border-warning/30' : 'bg-card text-muted-foreground border-border hover:bg-accent'
          )}
        >
          <AlertTriangle className="h-3 w-3" /> Low stock only
        </button>
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Ingredient', 'Category', 'Qty', 'UoM', 'Reorder Lvl', 'Status', 'Last Movement'].map(h => (
                <th key={h} className="text-left text-[11px] font-medium text-muted-foreground px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">No matching ingredients</td></tr>
            ) : (
              filtered.map(item => {
                const sc = STATUS_CONFIG[item.status];
                return (
                  <tr key={item.id} className={cn('border-b last:border-0 transition-colors',
                    item.status === 'out_of_stock' ? 'bg-destructive/[0.02]' : item.status === 'low' ? 'bg-warning/[0.02]' : 'hover:bg-muted/20'
                  )}>
                    <td className="px-4 py-2.5 text-sm font-medium text-foreground">{item.ingredientName}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.category}</td>
                    <td className={cn('px-4 py-2.5 text-sm font-semibold', item.status === 'out_of_stock' ? 'text-destructive' : item.status === 'low' ? 'text-warning' : 'text-foreground')}>
                      {item.currentQty}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.uom}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.reorderLevel}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', sc.class)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {TRANSACTION_TYPE_LABELS[item.lastMovementType] || item.lastMovementType}
                      <span className="block text-[10px]">{new Date(item.lastMovement).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
