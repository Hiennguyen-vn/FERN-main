import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/auth/auth-provider";
import { useAuth } from "@/auth/use-auth";
import Login from "./pages/Login";
import ShellLayout from "./layouts/ShellLayout";
import NotFound from "./pages/NotFound";
import { sessionRolesSet, effectiveRolesByOutletRecord } from "@/auth/authorization";
import type { AuthSession } from "@/api/auth-api";
import { PosRoleRedirect } from "./routes/pos-order/guards/PosRoleRedirect";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const POSPage = lazy(() => import("./pages/POSPage"));
const PublicOrderPage = lazy(() => import("./pages/PublicOrderPage"));
const InventoryModule = lazy(() => import("@/components/inventory/InventoryModule").then((m) => ({ default: m.InventoryModule })));
const ProcurementModule = lazy(() => import("@/components/procurement/ProcurementModule").then((m) => ({ default: m.ProcurementModule })));
const CatalogModule = lazy(() => import("@/components/catalog/CatalogModule").then((m) => ({ default: m.CatalogModule })));
const ReportsModule = lazy(() => import("@/components/reports/ReportsModule").then((m) => ({ default: m.ReportsModule })));
const AdminModule = lazy(() => import("@/components/admin/AdminModule").then((m) => ({ default: m.AdminModule })));
const AuditModule = lazy(() => import("@/components/audit/AuditModule").then((m) => ({ default: m.AuditModule })));
const IAMModule = lazy(() => import("@/components/iam/IAMModule").then((m) => ({ default: m.IAMModule })));
const FinanceModule = lazy(() => import("@/components/finance/FinanceModule").then((m) => ({ default: m.FinanceModule })));
const FinanceExpenseDetailPage = lazy(() => import("@/components/finance/FinanceOperatingExpensesWorkspace").then((m) => ({ default: m.FinanceExpenseDetailPage })));
const HRModule = lazy(() => import("@/components/hr/HRModule").then((m) => ({ default: m.HRModule })));
const OrgModule = lazy(() => import("@/components/org/OrgModule").then((m) => ({ default: m.OrgModule })));
const SettingsModule = lazy(() => import("@/components/settings/SettingsModule").then((m) => ({ default: m.SettingsModule })));
const CRMModule = lazy(() => import("@/components/crm/CRMModule").then((m) => ({ default: m.CRMModule })));
const PromotionsModule = lazy(() => import("@/components/promotions/PromotionsModule").then((m) => ({ default: m.PromotionsModule })));
// SchedulingModule absorbed into WorkforceModule — redirect kept for backward compat
const WorkforceModule = lazy(() => import("@/components/workforce/WorkforceModule").then((m) => ({ default: m.WorkforceModule })));
const PosOrderGate = lazy(() => import("./routes/pos-order/guards/PosOrderGate"));
const ProfilePage = lazy(() => import("@/components/profile/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const AiQueryModule = lazy(() => import("@/components/ai-query/AiQueryModule").then((m) => ({ default: m.AiQueryModule })));
const KitchenDisplayPage = lazy(() => import("./pages/KitchenDisplayPage"));

const PERSISTED_QUERY_PREFIXES = [
  ['sales', 'monthlyRevenue'],
  ['finance', 'monthlyExpenses'],
  ['payroll', 'monthly'],
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
    },
  },
});

function getPersistentStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const storage = window.localStorage;
    if (
      storage
      && typeof storage.getItem === 'function'
      && typeof storage.setItem === 'function'
      && typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const persistentStorage = getPersistentStorage();

if (persistentStorage) {
  const persister = createSyncStoragePersister({
    storage: persistentStorage,
    key: 'fern-finance-cache',
    throttleTime: 1000,
  });
  void persistQueryClient({
    queryClient,
    persister,
    maxAge: 60 * 60 * 1000,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || key.length < 2) return false;
        return PERSISTED_QUERY_PREFIXES.some(
          (prefix) => key[0] === prefix[0] && key[1] === prefix[1],
        );
      },
    },
  });
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
}

export class ModuleErrorBoundary extends Component<{ children: ReactNode }, ModuleErrorBoundaryState> {
  state: ModuleErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Module render failed', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="max-w-md rounded-md border bg-background p-5 text-center shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Module unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This workspace could not render. Refresh the page or switch modules.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <ModuleErrorBoundary>
      <Suspense
        fallback={(
          <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground">
            Loading module...
          </div>
        )}
      >
        {children}
      </Suspense>
    </ModuleErrorBoundary>
  );
}

function ProtectedShell() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Bootstrapping session...
      </div>
    );
  }
  if (!session?.accessToken) {
    return <Navigate to="/login" replace />;
  }
  return <ShellLayout />;
}

function LoginRoute() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session?.accessToken) {
    return <Navigate to={resolveLandingPath(session)} replace />;
  }
  return <Login />;
}

function RootRedirect() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session?.accessToken) return <Navigate to="/login" replace />;
  return <Navigate to={resolveLandingPath(session)} replace />;
}

function resolveLandingPath(session: AuthSession): string {
  const roles = sessionRolesSet(session);
  const isManager = roles.has('superadmin') || roles.has('admin')
    || roles.has('region_manager') || roles.has('outlet_manager');
  const isStaffOnly = !isManager && roles.has('staff');
  if (isStaffOnly) {
    const outletIds = Object.keys(effectiveRolesByOutletRecord(session));
    return outletIds.length === 1 ? `/posorder?outlet=${outletIds[0]}` : '/posorder';
  }
  return '/dashboard';
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/order/:tableToken" element={<LazyRoute><PublicOrderPage /></LazyRoute>} />
            <Route path="/posorder" element={<LazyRoute><PosOrderGate /></LazyRoute>} />

            <Route element={<ModuleErrorBoundary><ProtectedShell /></ModuleErrorBoundary>}>
              <Route path="/dashboard" element={<LazyRoute><DashboardPage /></LazyRoute>} />
              <Route path="/pos" element={<LazyRoute><PosRoleRedirect><POSPage /></PosRoleRedirect></LazyRoute>} />
              <Route path="/inventory" element={<LazyRoute><InventoryModule /></LazyRoute>} />
              <Route path="/procurement" element={<LazyRoute><ProcurementModule /></LazyRoute>} />
              <Route path="/catalog" element={<LazyRoute><CatalogModule /></LazyRoute>} />
              <Route path="/reports" element={<LazyRoute><ReportsModule /></LazyRoute>} />
              <Route path="/admin" element={<LazyRoute><AdminModule /></LazyRoute>} />
              <Route path="/audit" element={<LazyRoute><AuditModule /></LazyRoute>} />
              <Route path="/iam" element={<LazyRoute><IAMModule /></LazyRoute>} />
              <Route path="/finance" element={<LazyRoute><FinanceModule /></LazyRoute>} />
              <Route path="/finance/expenses/:expenseId" element={<LazyRoute><FinanceExpenseDetailPage /></LazyRoute>} />
              <Route path="/hr" element={<LazyRoute><HRModule /></LazyRoute>} />
              <Route path="/org" element={<Navigate to="/org/overview" replace />} />
              <Route path="/org/*" element={<LazyRoute><OrgModule /></LazyRoute>} />
              <Route path="/settings" element={<LazyRoute><SettingsModule /></LazyRoute>} />
              <Route path="/crm" element={<LazyRoute><CRMModule /></LazyRoute>} />
              <Route path="/promotions" element={<LazyRoute><PromotionsModule /></LazyRoute>} />
              <Route path="/scheduling" element={<Navigate to="/workforce" replace />} />
              <Route path="/workforce" element={<LazyRoute><WorkforceModule /></LazyRoute>} />
              <Route path="/profile" element={<LazyRoute><ProfilePage /></LazyRoute>} />
              <Route path="/ai-query" element={<LazyRoute><AiQueryModule /></LazyRoute>} />
              <Route path="/kitchen" element={<LazyRoute><KitchenDisplayPage /></LazyRoute>} />
            </Route>

            <Route path="/" element={<RootRedirect />} />
            <Route path="/shell" element={<RootRedirect />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
