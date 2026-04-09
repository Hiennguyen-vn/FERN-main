import {
  BarChart3,
  ChevronRight,
  DollarSign,
  Layers,
  Loader2,
  ShoppingCart,
  Store,
  Trophy,
  AlertTriangle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useRevenueReportData } from '@/hooks/use-dashboard-data';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--primary) / 0.7)',
  'hsl(var(--primary) / 0.4)',
  'hsl(var(--primary) / 0.25)',
];

export function RevenueDashboard() {
  const { outletRevenue, loading, error } = useRevenueReportData();

  const totalRevenue = outletRevenue.reduce((sum, outlet) => sum + outlet.revenue, 0);
  const totalOrders = outletRevenue.reduce((sum, outlet) => sum + outlet.orders, 0);
  const avgAOV = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
          <span className="text-foreground font-medium">Revenue</span>
        </div>
        <h2 className="text-lg font-semibold text-foreground">Revenue Dashboard</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Live outlet revenue without inventory-side fetch overhead.</p>
      </div>

      {error ? (
        <div className="permission-banner permission-banner-unavailable animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">Revenue feed unavailable</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: DollarSign },
          { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: ShoppingCart },
          { label: 'Avg Order Value', value: `$${avgAOV.toFixed(2)}`, icon: BarChart3 },
          { label: 'Outlets', value: String(outletRevenue.length), icon: Store },
        ].map((kpi) => (
          <div key={kpi.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Revenue by Outlet</span>
          </div>
          <div className="p-4">
            {outletRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No revenue data yet</div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={outletRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="outletName"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(value) => `$${value}`}
                      axisLine={false}
                      tickLine={false}
                      width={50}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--card))',
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 surface-elevated overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Revenue Share</span>
          </div>
          <div className="p-4">
            {outletRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No data</div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={outletRevenue.map((outlet) => ({ name: outlet.outletName, value: outlet.revenue }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {outletRevenue.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--card))',
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`]}
                    />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="surface-elevated overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Outlet Performance Ranking</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-center w-12">Rank</th>
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left">Outlet</th>
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-right">Revenue</th>
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-right">Orders</th>
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-right">AOV</th>
              <th className="text-[11px] font-medium text-muted-foreground px-4 py-2.5 text-left w-28">Share</th>
            </tr>
          </thead>
          <tbody>
            {outletRevenue.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No revenue data available</td></tr>
            ) : outletRevenue.map((outlet, index) => {
              const share = totalRevenue > 0 ? (outlet.revenue / totalRevenue) * 100 : 0;
              return (
                <tr key={outlet.outletId} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold',
                        index === 0 ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{outlet.outletName}</p>
                    {index === 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-warning font-medium mt-0.5">
                        <Trophy className="h-2.5 w-2.5" /> Top performer
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-foreground">${outlet.revenue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-sm text-foreground">{outlet.orders}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">${outlet.avgOrderValue.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full bg-primary/50 rounded-full transition-all" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{share.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
