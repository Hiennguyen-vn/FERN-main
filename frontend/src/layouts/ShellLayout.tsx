import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppSidebar } from '@/components/shell/AppSidebar';
import { TopBar } from '@/components/shell/TopBar';
import { useAuth } from '@/auth/use-auth';
import { orgApi } from '@/api/fern-api';
import type {
  ShellScope,
  ScopeLevel,
  ModuleFamily,
  ScopeOption,
} from '@/types/shell';
import {
  PATH_TO_FAMILY,
  buildShellUser,
  collectAccessibleFamilies,
  computeScopeTree,
  defaultScope,
  FAMILY_TO_PATH,
  filterAccessibleModules,
  filterActionHub,
} from '@/layouts/shell-layout-helpers';

const ScopeSelector = lazy(() => import('@/components/shell/ScopeSelector').then((module) => ({ default: module.ScopeSelector })));
const QuickActionsPanel = lazy(() => import('@/components/shell/QuickActionsPanel').then((module) => ({ default: module.QuickActionsPanel })));
const NotificationPanel = lazy(() => import('@/components/shell/NotificationPanel').then((module) => ({ default: module.NotificationPanel })));

const ROUTE_META: Record<string, { title: string; breadcrumbs: string[] }> = {
  '/dashboard': { title: 'Outlet Control Center', breadcrumbs: ['Home', 'Dashboard'] },
  '/pos': { title: 'Point of Sale', breadcrumbs: ['POS'] },
  '/order': { title: 'Customer Order Queue', breadcrumbs: ['POS', 'Customer Orders'] },
  '/inventory': { title: 'Inventory', breadcrumbs: ['Operations', 'Inventory'] },
  '/procurement': { title: 'Procurement', breadcrumbs: ['Operations', 'Procurement'] },
  '/catalog': { title: 'Catalog', breadcrumbs: ['Operations', 'Catalog'] },
  '/reports': { title: 'Reports', breadcrumbs: ['Insights', 'Reports'] },
  '/audit': { title: 'Audit Trail', breadcrumbs: ['Insights', 'Audit'] },
  '/iam': { title: 'Access Management', breadcrumbs: ['Administration', 'IAM'] },
  '/finance': { title: 'Finance', breadcrumbs: ['Finance & People', 'Finance'] },
  '/hr': { title: 'Human Resources', breadcrumbs: ['Finance & People', 'HR'] },
  '/settings': { title: 'Settings', breadcrumbs: ['Administration', 'Settings'] },
  '/crm': { title: 'CRM', breadcrumbs: ['Customer', 'CRM'] },
  '/promotions': { title: 'Promotions', breadcrumbs: ['Sales', 'Promotions'] },
  '/scheduling': { title: 'Scheduling', breadcrumbs: ['People', 'Scheduling'] },
  '/workforce': { title: 'Workforce', breadcrumbs: ['People', 'Workforce'] },
};

export default function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, logout, refreshSession } = useAuth();
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>('outlet');
  const [customScope, setCustomScope] = useState<ShellScope | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const attemptedScopeRecovery = useRef(false);

  const hierarchyQuery = useQuery({
    queryKey: ['org', 'hierarchy', session?.sessionId ?? 'none'],
    enabled: Boolean(session),
    retry: 1,
    queryFn: async () => {
      const hierarchy = await orgApi.hierarchy(session!.accessToken);
      if (hierarchy.outlets.length > 0) {
        return hierarchy;
      }

      const fallbackOutlets = await orgApi.outlets(session!.accessToken);
      if (fallbackOutlets.length === 0) {
        return hierarchy;
      }

      const regionIds = new Set(hierarchy.regions.map((region) => region.id));
      const inferredRegions = [...new Set(fallbackOutlets.map((outlet) => outlet.regionId))]
        .filter((regionId) => regionId && !regionIds.has(regionId))
        .map((regionId) => ({
          id: regionId,
          code: String(regionId),
          name: `Region ${regionId}`,
        }));

      return {
        regions: [...hierarchy.regions, ...inferredRegions],
        outlets: fallbackOutlets,
      };
    },
  });

  useEffect(() => {
    if (!session) {
      attemptedScopeRecovery.current = false;
      return;
    }
    if (hierarchyQuery.isLoading || hierarchyQuery.isError) return;
    if (hierarchyQuery.data?.outlets?.length) return;
    if (attemptedScopeRecovery.current) return;

    attemptedScopeRecovery.current = true;
    void refreshSession()
      .catch((error) => {
        console.error('Scope recovery refresh failed:', error);
      })
      .finally(() => {
        void hierarchyQuery.refetch();
      });
  }, [
    hierarchyQuery,
    hierarchyQuery.data?.outlets?.length,
    hierarchyQuery.isError,
    hierarchyQuery.isLoading,
    hierarchyQuery.refetch,
    refreshSession,
    session,
  ]);

  const visibleModules = useMemo(() => filterAccessibleModules(session), [session]);

  const accessibleFamilies = useMemo(
    () => collectAccessibleFamilies(session),
    [session],
  );

  const filteredActionHub = useMemo(() => filterActionHub(session), [session]);

  const scopeTree = useMemo<ScopeOption[]>(() => {
    const data = hierarchyQuery.data;
    if (data && data.outlets.length > 0) {
      return computeScopeTree(data.regions, data.outlets);
    }
    return [{ id: 'system', name: 'All Regions', level: 'system', children: [] }];
  }, [hierarchyQuery.data]);

  const currentScope = customScope || defaultScope(scopeLevel, scopeTree);

  const shellUser = useMemo(() => buildShellUser(session), [session]);

  const basePath = '/' + location.pathname.split('/')[1];
  const meta = ROUTE_META[basePath] || { title: 'OpsCenter', breadcrumbs: [] };
  const activeFamily = PATH_TO_FAMILY[basePath] as ModuleFamily | undefined;
  const defaultPath = visibleModules[0]?.path || '/dashboard';

  useEffect(() => {
    if (!activeFamily) return;
    if (accessibleFamilies.has(activeFamily)) return;
    navigate(defaultPath, { replace: true });
  }, [accessibleFamilies, activeFamily, defaultPath, navigate]);

  const handleScopeChange = (newScope: ShellScope) => {
    setCustomScope(newScope);
    setScopeLevel(newScope.level);
  };

  const handleNavigate = (family: ModuleFamily) => {
    const path = FAMILY_TO_PATH[family];
    if (path) navigate(path);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar
        modules={visibleModules}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onNavigate={handleNavigate}
        activeFamily={activeFamily}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          pageTitle={meta.title}
          breadcrumbs={meta.breadcrumbs}
          scope={currentScope}
          user={shellUser}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenScope={() => setScopeOpen(true)}
          onOpenQuickActions={() => setQuickActionsOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onLogout={() => {
            void logout().finally(() => navigate('/login'));
          }}
          notificationCount={hierarchyQuery.isError ? 1 : 0}
        />

        <main className="flex-1 overflow-y-auto flex flex-col">
          <Outlet context={{ scope: currentScope, user: shellUser }} />
        </main>
      </div>

      {scopeOpen ? (
        <Suspense fallback={null}>
          <ScopeSelector
            open={scopeOpen}
            onClose={() => setScopeOpen(false)}
            currentScope={currentScope}
            scopeTree={scopeTree}
            onScopeChange={handleScopeChange}
          />
        </Suspense>
      ) : null}
      {quickActionsOpen ? (
        <Suspense fallback={null}>
          <QuickActionsPanel
            open={quickActionsOpen}
            onClose={() => setQuickActionsOpen(false)}
            actionHub={filteredActionHub}
            scope={currentScope}
          />
        </Suspense>
      ) : null}
      {notificationsOpen ? (
        <Suspense fallback={null}>
          <NotificationPanel
            open={notificationsOpen}
            onClose={() => setNotificationsOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
