import {
  AlertTriangle,
  ArrowDownRight,
  CheckCircle2,
  ChevronRight,
  Layers,
  Loader2,
  Store,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInventoryHealthData, type LowStockAlert } from '@/hooks/use-dashboard-data';

export function InventoryHealth() {
  const { lowStockItems, loading, error } = useInventoryHealthData();

  const outOfStockCount = lowStockItems.filter((item) => item.quantity === 0).length;
  const lowStockCount = lowStockItems.filter((item) => item.quantity > 0).length;
  const byOutlet = lowStockItems.reduce<Record<string, LowStockAlert[]>>((groups, item) => {
    (groups[item.outletName] = groups[item.outletName] || []).push(item);
    return groups;
  }, {});

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
          <Layers className="h-3 w-3" />
          <span>Reports</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Inventory</span>
        </div>
        <h2 className="text-lg font-semibold text-foreground">Inventory Health</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Stock alerts load independently from revenue charts.</p>
      </div>

      {error ? (
        <div className="permission-banner permission-banner-unavailable animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">Inventory feed unavailable</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Alerts', value: String(lowStockItems.length), icon: AlertTriangle, color: lowStockItems.length > 0 ? 'text-warning' : 'text-foreground' },
          { label: 'Low Stock', value: String(lowStockCount), icon: ArrowDownRight, color: lowStockCount > 0 ? 'text-warning' : 'text-foreground' },
          { label: 'Out of Stock', value: String(outOfStockCount), icon: XCircle, color: outOfStockCount > 0 ? 'text-destructive' : 'text-foreground' },
          { label: 'Outlets Affected', value: String(Object.keys(byOutlet).length), icon: Store, color: 'text-foreground' },
        ].map((kpi) => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className={cn('text-xl font-semibold', kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Low Stock / Out of Stock Items</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left">Item</th>
                <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left">Outlet</th>
                <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-right">On Hand</th>
                <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-right">Reorder Level</th>
                <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStockItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    <CheckCircle2 className="h-5 w-5 text-success mx-auto mb-2" />
                    All items are above reorder level
                  </td>
                </tr>
              ) : lowStockItems.map((item, index) => (
                <tr key={`${item.outletName}:${item.itemName}:${index}`} className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors', item.quantity === 0 && 'bg-destructive/[0.02]')}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium text-foreground">{item.itemName}</p>
                    <p className="text-[10px] text-muted-foreground">{item.category}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.outletName}</td>
                  <td className={cn('px-4 py-2.5 text-sm text-right font-medium', item.quantity === 0 ? 'text-destructive' : 'text-warning')}>
                    {item.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right text-muted-foreground">{item.reorderLevel}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-full',
                        item.quantity === 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                      )}
                    >
                      {item.quantity === 0 ? 'Out of Stock' : 'Low'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-2 surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Alerts by Outlet</span>
          </div>
          {Object.keys(byOutlet).length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No alerts</div>
          ) : (
            <div className="divide-y divide-border">
              {Object.entries(byOutlet).map(([outlet, items]) => {
                const outletOutOfStockCount = items.filter((item) => item.quantity === 0).length;
                return (
                  <div key={outlet} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-medium text-foreground">{outlet}</p>
                      <span className="text-[10px] font-medium text-muted-foreground">{items.length} items</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px]">
                      {outletOutOfStockCount > 0 ? (
                        <span className="text-destructive flex items-center gap-0.5">
                          <XCircle className="h-2.5 w-2.5" /> {outletOutOfStockCount} out of stock
                        </span>
                      ) : null}
                      <span className="text-warning flex items-center gap-0.5">
                        <ArrowDownRight className="h-2.5 w-2.5" /> {items.length - outletOutOfStockCount} low
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
