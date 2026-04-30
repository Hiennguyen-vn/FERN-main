import { Suspense, lazy, useState } from 'react';
import { AlertTriangle, RotateCcw, Wallet, UserCog, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type AdminTab = 'price-drift' | 'dlt' | 'cash' | 'loyalty';

const PriceDriftPage = lazy(() => import('@/components/admin/PriceDriftPage').then(m => ({ default: m.PriceDriftPage })));
const DltReplayPage  = lazy(() => import('@/components/admin/DltReplayPage').then(m => ({ default: m.DltReplayPage })));
const CashReconPage  = lazy(() => import('@/components/admin/CashReconPage').then(m => ({ default: m.CashReconPage })));
const LoyaltyPage    = lazy(() => import('@/components/admin/LoyaltyPage').then(m => ({ default: m.LoyaltyPage })));

const TABS: Array<{ key: AdminTab; label: string; icon: typeof AlertTriangle }> = [
  { key: 'price-drift', label: 'Price Drift',         icon: AlertTriangle },
  { key: 'dlt',         label: 'Failed Sync (DLT)',   icon: RotateCcw     },
  { key: 'cash',        label: 'Cash Reconciliation', icon: Wallet        },
  { key: 'loyalty',     label: 'Loyalty Customers',   icon: UserCog       },
];

function AdminFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function AdminModule() {
  const [tab, setTab] = useState<AdminTab>('price-drift');
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<AdminFallback />}>
          {tab === 'price-drift' && <PriceDriftPage />}
          {tab === 'dlt' && <DltReplayPage />}
          {tab === 'cash' && <CashReconPage />}
          {tab === 'loyalty' && <LoyaltyPage />}
        </Suspense>
      </div>
    </div>
  );
}
