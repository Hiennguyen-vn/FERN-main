import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
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
} from '@/layouts/shell-layout-helpers';

import { ScopeSelector } from '@/components/shell/ScopeSelector';

const NotificationPanel = lazy(() => import('@/components/shell/NotificationPanel').then((module) => ({ default: module.NotificationPanel })));

const attemptedScopeRecoverySessions = new Set<string>();

const SCOPE_STORAGE_KEY = 'fern.scope.v1';

function encodeScopeParam(scope: ShellScope): string | null {
  if (scope.level === 'outlet' && scope.outletId) return `outlet:${scope.outletId}`;
  if (scope.level === 'region' && scope.regionId) return `region:${scope.regionId}`;
  if (scope.level === 'system') return 'system';
  return null;
}

function decodeScopeParam(
  raw: string | null | undefined,
  scopeTree: ScopeOption[],
): ShellScope | null {
  if (!raw) return null;
  if (raw === 'system') return { level: 'system' };
  const [kind, id] = raw.split(':');
  if (!id) return null;
  const system = scopeTree[0];
  if (!system?.children) return null;
  for (const region of system.children) {
    if (kind === 'region' && region.id === id) {
      return { level: 'region', regionId: region.id, regionName: region.name };
    }
    for (const outlet of region.children ?? []) {
      if (kind === 'outlet' && outlet.id === id) {
        return {
          level: 'outlet',
          regionId: region.id,
          regionName: region.name,
          outletId: outlet.id,
          outletName: outlet.name,
        };
      }
    }
  }
  return null;
}

const ROUTE_META: Record<string, { title: string; breadcrumbs: string[] }> = {
  '/dashboard': { title: 'Outlet Control Center', breadcrumbs: ['Home', 'Dashboard'] },
  '/pos': { title: 'Point of Sale', breadcrumbs: ['POS'] },
  '/inventory': { title: 'Inventory', breadcrumbs: ['Operations', 'Inventory'] },
  '/procurement': { title: 'Procurement', breadcrumbs: ['Operations', 'Procurement'] },
  '/catalog': { title: 'Catalog', breadcrumbs: ['Operations', 'Catalog'] },
  '/reports': { title: 'Regional Ops', breadcrumbs: ['Organization', 'Regional Ops'] },
  '/audit': { title: 'Audit Trail', breadcrumbs: ['Insights', 'Audit'] },
  '/iam': { title: 'Access Management', breadcrumbs: ['Administration', 'IAM'] },
  '/finance': { title: 'Finance', breadcrumbs: ['Finance & People', 'Finance'] },
  '/hr': { title: 'Human Resources', breadcrumbs: ['Finance & People', 'HR'] },
  '/org': { title: 'Organization', breadcrumbs: ['Administration', 'Organization'] },
  '/settings': { title: 'Settings', breadcrumbs: ['Administration', 'Settings'] },
  '/crm': { title: 'CRM', breadcrumbs: ['Customer', 'CRM'] },
  '/promotions': { title: 'Promotions', breadcrumbs: ['Sales', 'Promotions'] },
  '/scheduling': { title: 'Scheduling', breadcrumbs: ['People', 'Scheduling'] },
  '/workforce': { title: 'Workforce', breadcrumbs: ['People', 'Workforce'] },
  '/profile': { title: 'My Account', breadcrumbs: ['Account', 'Profile'] },
};

export default function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, logout, refreshSession } = useAuth();
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>('outlet');
  const [customScope, setCustomScope] = useState<ShellScope | null>(null);
  const scopeHydratedRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [scopeSelectorOpen, setScopeSelectorOpen] = useState(false);
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
  const hierarchyOutletCount = hierarchyQuery.data?.outlets?.length ?? 0;
  const hierarchyIsError = hierarchyQuery.isError;
  const hierarchyIsLoading = hierarchyQuery.isLoading;
  const refetchHierarchy = hierarchyQuery.refetch;

  useEffect(() => {
    if (!session) {
      attemptedScopeRecovery.current = false;
      return;
    }
    if (hierarchyIsLoading || hierarchyIsError) return;
    if (hierarchyOutletCount > 0) return;
    if (attemptedScopeRecovery.current) return;
    if (attemptedScopeRecoverySessions.has(session.user.id)) return;

    attemptedScopeRecovery.current = true;
    attemptedScopeRecoverySessions.add(session.user.id);
    void refreshSession()
      .catch((error) => {
        console.error('Scope recovery refresh failed:', error);
      })
      .finally(() => {
        void refetchHierarchy();
      });
  }, [
    hierarchyIsError,
    hierarchyIsLoading,
    hierarchyOutletCount,
    refetchHierarchy,
    refreshSession,
    session,
  ]);

  const visibleModules = useMemo(() => filterAccessibleModules(session), [session]);

  const accessibleFamilies = useMemo(
    () => collectAccessibleFamilies(session),
    [session],
  );

  const scopeTree = useMemo<ScopeOption[]>(() => {
    const data = hierarchyQuery.data;
    if (data && data.outlets.length > 0) {
      return computeScopeTree(data.regions, data.outlets, session?.scopeAssignments);
    }
    return [{ id: 'system', name: 'All Regions', level: 'system', children: [] }];
  }, [hierarchyQuery.data, session?.scopeAssignments]);

  // Hydrate scope from URL ?scope=... (preferred) or localStorage on first tree resolve.
  useEffect(() => {
    if (scopeHydratedRef.current) return;
    if (!scopeTree[0]?.children?.length) return;
    const fromUrl = decodeScopeParam(searchParams.get('scope'), scopeTree);
    let hydrated: ShellScope | null = fromUrl;
    if (!hydrated) {
      try {
        const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
        hydrated = decodeScopeParam(stored, scopeTree);
      } catch {
        hydrated = null;
      }
    }
    if (hydrated) {
      setCustomScope(hydrated);
      setScopeLevel(hydrated.level);
    }
    scopeHydratedRef.current = true;
  }, [scopeTree, searchParams]);

  // Auto-select: find first leaf region (one that directly contains outlets)
  // and auto-select the appropriate scope level.
  useEffect(() => {
    if (customScope) return;
    if (!scopeHydratedRef.current) return;

    // Walk tree to find leaf regions (regions with outlet children)
    const leafRegions: ScopeOption[] = [];
    function walk(nodes: ScopeOption[]) {
      for (const node of nodes) {
        if (node.level === 'region' && node.children?.some((c) => c.level === 'outlet')) {
          leafRegions.push(node);
        }
        if (node.children) walk(node.children);
      }
    }
    walk(scopeTree[0]?.children || []);

    const totalOutlets = leafRegions.reduce((sum, r) => sum + (r.children?.length || 0), 0);

    if (totalOutlets === 0) return;

    // Single outlet → auto-select it
    if (totalOutlets === 1) {
      const region = leafRegions[0];
      const outlet = region.children![0];
      setCustomScope({
        level: 'outlet',
        regionId: region.id,
        regionName: region.name,
        outletId: outlet.id,
        outletName: outlet.name,
      });
      setScopeLevel('outlet');
      return;
    }

    // Multiple outlets → auto-select first leaf region (so outlet chips appear)
    const firstLeaf = leafRegions[0];
    if (firstLeaf) {
      setCustomScope({
        level: 'region',
        regionId: firstLeaf.id,
        regionName: firstLeaf.name,
      });
      setScopeLevel('region');
    }
  }, [scopeTree, customScope]);

  const currentScope = customScope || defaultScope(scopeLevel, scopeTree);

  // Keep the in-memory scope aligned when a route is opened with a different
  // ?scope=... value after initial hydration, for example direct links or tests.
  useEffect(() => {
    if (!scopeHydratedRef.current) return;
    if (!scopeTree[0]?.children?.length) return;
    const fromUrl = decodeScopeParam(searchParams.get('scope'), scopeTree);
    if (!fromUrl) return;
    const currentEncoded = encodeScopeParam(currentScope);
    const nextEncoded = encodeScopeParam(fromUrl);
    if (!nextEncoded || nextEncoded === currentEncoded) return;
    setCustomScope(fromUrl);
    setScopeLevel(fromUrl.level);
    try {
      window.localStorage.setItem(SCOPE_STORAGE_KEY, nextEncoded);
    } catch {
      /* ignore */
    }
  }, [currentScope, scopeTree, searchParams]);

  const shellUser = useMemo(() => buildShellUser(session), [session]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        e.preventDefault();
        setScopeSelectorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const basePath = '/' + location.pathname.split('/')[1];
  const meta = ROUTE_META[basePath] || { title: 'FERN', breadcrumbs: [] };
  const activeFamily = PATH_TO_FAMILY[basePath] as ModuleFamily | undefined;
  const defaultPath = visibleModules[0]?.path || '/dashboard';

  useEffect(() => {
    if (!activeFamily) return;
    if (accessibleFamilies.has(activeFamily)) return;
    navigate(defaultPath, { replace: true });
  }, [accessibleFamilies, activeFamily, defaultPath, navigate]);

  const handleScopeChange = useCallback((newScope: ShellScope) => {
    setCustomScope(newScope);
    setScopeLevel(newScope.level);
    const encoded = encodeScopeParam(newScope);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (encoded) next.set('scope', encoded);
        else next.delete('scope');
        return next;
      },
      { replace: true },
    );
    try {
      if (encoded) window.localStorage.setItem(SCOPE_STORAGE_KEY, encoded);
    } catch {
      /* ignore */
    }
  }, [setSearchParams]);

  // Keep URL ?scope= in sync when scope changes via auto-select / hydration.
  useEffect(() => {
    if (!scopeHydratedRef.current) return;
    const encoded = encodeScopeParam(currentScope);
    if (!encoded) return;
    const decodedFromUrl = decodeScopeParam(searchParams.get('scope'), scopeTree);
    const decodedEncoded = decodedFromUrl ? encodeScopeParam(decodedFromUrl) : null;
    if (decodedEncoded && decodedEncoded !== encoded) return;
    if (searchParams.get('scope') === encoded) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('scope', encoded);
        return next;
      },
      { replace: true },
    );
    try {
      window.localStorage.setItem(SCOPE_STORAGE_KEY, encoded);
    } catch {
      /* ignore */
    }
  }, [currentScope, searchParams, setSearchParams]);

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
          scope={currentScope}
          user={shellUser}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenScope={() => setScopeSelectorOpen(true)}
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

      {notificationsOpen ? (
        <Suspense fallback={null}>
          <NotificationPanel
            open={notificationsOpen}
            onClose={() => setNotificationsOpen(false)}
          />
        </Suspense>
      ) : null}
      <ScopeSelector
        open={scopeSelectorOpen}
        onClose={() => setScopeSelectorOpen(false)}
        currentScope={currentScope}
        scopeTree={scopeTree}
        onScopeChange={(newScope) => { handleScopeChange(newScope); setScopeSelectorOpen(false); }}
      />
    </div>
  );
}
