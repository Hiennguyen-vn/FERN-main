import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Lock,
  PieChart,
  Receipt,
  TableProperties,
  TrendingUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  orgApi,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { useAuth } from '@/auth/use-auth';
import { ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import {
  FINANCE_TAB_ITEMS,
  type FinanceTab,
} from '@/components/finance/finance-workspace-config';
import { FinanceOverviewWorkspace } from '@/components/finance/FinanceOverviewWorkspace';
import { FinanceRevenueWorkspace } from '@/components/finance/FinanceRevenueWorkspace';
import { FinanceLaborWorkspace } from '@/components/finance/FinanceLaborWorkspace';
import { FinanceOperatingExpensesWorkspace } from '@/components/finance/FinanceOperatingExpensesWorkspace';
import { FinancePLWorkspace } from '@/components/finance/FinancePLWorkspace';
import { FinancePrimeCostWorkspace } from '@/components/finance/FinancePrimeCostWorkspace';
import { FinancePeriodCloseWorkspace } from '@/components/finance/FinancePeriodCloseWorkspace';
import { resolveCanonicalRoles } from '@/components/finance/finance-utils';

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

const TAB_ICONS: Record<FinanceTab, React.ElementType> = {
  overview: LayoutDashboard,
  pl: TableProperties,
  revenue: TrendingUp,
  labor: Users,
  expenses: Receipt,
  'prime-cost': PieChart,
  close: Lock,
};

export function FinanceModule() {
  const { token, scope } = useShellRuntime();
  const { session } = useAuth();
  const regionId = normalizeNumeric(scope.regionId);
  const outletId = normalizeNumeric(scope.outletId);

  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);

  const roles = useMemo(
    () => resolveCanonicalRoles(session?.rolesByOutlet),
    [session?.rolesByOutlet],
  );

  const isSuperadmin = roles.has('superadmin');
  const isFinance = roles.has('finance');
  const isHr = roles.has('hr');
  const isRegionManager = roles.has('region_manager');
  const isOutletManager = roles.has('outlet_manager');

  const visibleTabs = useMemo((): Set<FinanceTab> => {
    const tabs = new Set<FinanceTab>(['overview'] as FinanceTab[]);
    if (isSuperadmin || isFinance || isRegionManager || isOutletManager) tabs.add('revenue');
    if (isSuperadmin || isFinance || isHr || isOutletManager) tabs.add('labor');
    if (isSuperadmin || isFinance || isOutletManager || isRegionManager) tabs.add('expenses');
    if (isSuperadmin || isFinance || isRegionManager) tabs.add('pl');
    if (isSuperadmin || isFinance || isRegionManager) tabs.add('prime-cost');
    if (isSuperadmin || isFinance) tabs.add('close');
    return tabs;
  }, [isSuperadmin, isFinance, isHr, isRegionManager, isOutletManager]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void orgApi.hierarchy(token)
      .then((hierarchy) => {
        if (!active) return;
        setRegions(hierarchy.regions || []);
        setOutlets(hierarchy.outlets || []);
      })
      .catch((error: unknown) => {
        console.error('Finance org hierarchy load failed', error);
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!visibleTabs.has(activeTab)) {
      setActiveTab('overview');
    }
  }, [visibleTabs, activeTab]);

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="Finance" />;
  }

  const navigateTo = (tab: FinanceTab) => {
    if (visibleTabs.has(tab)) setActiveTab(tab);
  };

  const sharedWorkspaceProps = {
    token,
    scopeRegionId: regionId || undefined,
    scopeOutletId: outletId || undefined,
    regions,
    outlets,
  };

  let workspace: React.ReactNode;

  switch (activeTab) {
    case 'overview':
      workspace = <FinanceOverviewWorkspace {...sharedWorkspaceProps} onNavigate={navigateTo} />;
      break;
    case 'pl':
      workspace = <FinancePLWorkspace {...sharedWorkspaceProps} />;
      break;
    case 'revenue':
      workspace = <FinanceRevenueWorkspace {...sharedWorkspaceProps} onNavigate={navigateTo} />;
      break;
    case 'labor':
      workspace = <FinanceLaborWorkspace {...sharedWorkspaceProps} />;
      break;
    case 'expenses':
      workspace = <FinanceOperatingExpensesWorkspace {...sharedWorkspaceProps} />;
      break;
    case 'prime-cost':
      workspace = <FinancePrimeCostWorkspace {...sharedWorkspaceProps} />;
      break;
    case 'close':
      workspace = <FinancePeriodCloseWorkspace {...sharedWorkspaceProps} onNavigate={navigateTo} />;
      break;
    default:
      workspace = null;
  }

  const visibleTabItems = FINANCE_TAB_ITEMS.filter((tab) => visibleTabs.has(tab.key));

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="flex flex-shrink-0 items-center gap-0 border-b bg-card px-6">
        {visibleTabItems.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">{workspace}</div>
    </div>
  );
}
