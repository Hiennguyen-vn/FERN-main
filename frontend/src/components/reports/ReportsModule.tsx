import { Suspense, lazy, useState } from 'react';
import { BarChart3, DollarSign, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type ReportTab = 'revenue' | 'inventory';

const RevenueDashboard = lazy(() => import('@/components/reports/RevenueDashboard').then((module) => ({ default: module.RevenueDashboard })));
const InventoryHealth = lazy(() => import('@/components/reports/InventoryHealth').then((module) => ({ default: module.InventoryHealth })));

const REPORT_TABS: Array<{ key: ReportTab; label: string; icon: typeof DollarSign }> = [
  { key: 'revenue', label: 'Revenue Dashboard', icon: DollarSign },
  { key: 'inventory', label: 'Inventory Health', icon: BarChart3 },
];

function ReportsFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function ReportsModule() {
  const [activeTab, setActiveTab] = useState<ReportTab>('revenue');

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<ReportsFallback />}>
          {activeTab === 'revenue' ? <RevenueDashboard /> : <InventoryHealth />}
        </Suspense>
      </div>
    </div>
  );
}
