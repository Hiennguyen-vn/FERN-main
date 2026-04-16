import { BarChart3, TrendingUp } from 'lucide-react';

interface Props {
  onNavigate: (tab: string) => void;
}

export function FinanceRevenueWorkspace({ onNavigate }: Props) {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="surface-elevated px-5 py-4">
        <div className="flex items-start gap-3">
          <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold">Revenue Analytics</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Gross sales, discounts, refunds, voids, net sales, and payment mix — broken down by outlet and period.
            </p>
          </div>
        </div>
      </div>

      <div className="surface-elevated px-5 py-12 text-center">
        <BarChart3 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
        <h4 className="text-base font-semibold">Revenue data — Phase 2</h4>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Revenue Analytics requires integration with the Sales service to aggregate
          gross sales, discounts, refunds, and payment mix by outlet and period.
          This workspace will be enabled once the sales-service aggregation API is available.
        </p>

        <div className="mx-auto mt-8 max-w-lg rounded-lg border border-blue-200 bg-blue-50/70 px-5 py-4 text-left text-sm text-blue-900">
          <p className="font-medium">What will be here in Phase 2:</p>
          <ul className="mt-2 space-y-1 text-xs text-blue-800">
            <li>• Net Sales KPI with period-over-period delta</li>
            <li>• Discounts, refunds, voids breakdown</li>
            <li>• Revenue by outlet comparison table</li>
            <li>• Daily trend chart (bar, per outlet toggle)</li>
            <li>• Payment mix: Cash / Card / E-wallet split</li>
            <li>• Revenue channel breakdown: Dine-in / Delivery / Takeout</li>
          </ul>
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => onNavigate('expenses')}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            View Operating Expenses
          </button>
          <button
            onClick={() => onNavigate('overview')}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Back to Overview
          </button>
        </div>
      </div>
    </div>
  );
}
