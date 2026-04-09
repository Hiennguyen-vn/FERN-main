import type { ShellScope, PermissionState } from '@/types/shell';
import { PermissionBanner, ServiceUnavailablePage } from './PermissionStates';
import {
  TrendingUp, DollarSign, ShoppingBag, Users, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

interface DashboardContentProps {
  scope: ShellScope;
}

function MetricCard({
  label, value, change, positive, icon: Icon,
}: {
  label: string; value: string; change: string; positive: boolean; icon: React.ElementType;
}) {
  return (
    <div className="surface-elevated p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground mt-1.5">{value}</p>
        </div>
        <div className="h-9 w-9 rounded-lg bg-primary/8 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs">
        {positive ? (
          <ArrowUpRight className="h-3 w-3 text-success" />
        ) : (
          <ArrowDownRight className="h-3 w-3 text-destructive" />
        )}
        <span className={positive ? 'text-success' : 'text-destructive'}>{change}</span>
        <span className="text-muted-foreground">vs last period</span>
      </div>
    </div>
  );
}

export function DashboardContent({ scope }: DashboardContentProps) {
  const scopeLabel = scope.outletName || scope.regionName || 'All Outlets';

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Scope context */}
      <div>
        <h2 className="text-lg font-semibold text-foreground">Operations Overview</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Showing data for <span className="font-medium text-foreground">{scopeLabel}</span>
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Today's Revenue" value="$12,847" change="+8.2%" positive icon={DollarSign} />
        <MetricCard label="Orders" value="342" change="+12.5%" positive icon={ShoppingBag} />
        <MetricCard label="Active Staff" value="28" change="-2" positive={false} icon={Users} />
        <MetricCard label="Avg. Ticket" value="$37.56" change="+3.1%" positive icon={TrendingUp} />
      </div>

      {/* Sample data table */}
      <div className="surface-elevated">
        <div className="px-5 py-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Recent Transactions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Order ID</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Time</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Items</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { id: 'ORD-4821', time: '14:32', items: 3, amount: '$42.50', status: 'Completed' },
                { id: 'ORD-4820', time: '14:28', items: 1, amount: '$12.00', status: 'Completed' },
                { id: 'ORD-4819', time: '14:15', items: 5, amount: '$67.80', status: 'Preparing' },
                { id: 'ORD-4818', time: '14:02', items: 2, amount: '$28.90', status: 'Completed' },
                { id: 'ORD-4817', time: '13:55', items: 4, amount: '$55.20', status: 'Completed' },
              ].map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{row.id}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{row.time}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{row.items} items</td>
                  <td className="px-5 py-3 text-sm text-foreground text-right font-medium">{row.amount}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      row.status === 'Completed'
                        ? 'bg-success/10 text-success'
                        : 'bg-warning/10 text-warning'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permission state demos */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Permission-Aware States</h3>
        <PermissionBanner state="read_only" moduleName="Finance" />
        <PermissionBanner state="action_disabled" detail="Requires finance:approve permission to approve purchase orders." />
        <PermissionBanner state="export_unavailable" moduleName="Reports" />
        <PermissionBanner state="scope_mismatch" detail="This data belongs to North Region. Switch your scope to access it." />
        <PermissionBanner state="branch_blocked" moduleName="Access Management" />
        <PermissionBanner state="service_unavailable" moduleName="Workforce" />
        <PermissionBanner state="route_unavailable" moduleName="Audit Trail" />
      </div>

      {/* Masked field demo */}
      <div className="surface-elevated p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Field Masking Example</h3>
        <PermissionBanner state="field_masked" moduleName="Employee Records" />
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Employee Name</p>
            <p className="text-sm text-foreground">John Smith</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Salary</p>
            <p className="text-sm field-masked">$85,000</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Department</p>
            <p className="text-sm text-foreground">Operations</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">SSN</p>
            <p className="text-sm field-masked">123-45-6789</p>
          </div>
        </div>
      </div>
    </div>
  );
}
