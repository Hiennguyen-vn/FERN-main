import { Suspense, lazy, type ReactNode } from "react";
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
import { PosRoleRedirect } from "./routes/pos-order/guards/PosRoleRedirect";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const POSPage = lazy(() => import("./pages/POSPage"));
const CustomerOrdersPage = lazy(() => import("./pages/CustomerOrdersPage"));
const PublicOrderPage = lazy(() => import("./pages/PublicOrderPage"));
const InventoryModule = lazy(() => import("@/components/inventory/InventoryModule").then((m) => ({ default: m.InventoryModule })));
const ProcurementModule = lazy(() => import("@/components/procurement/ProcurementModule").then((m) => ({ default: m.ProcurementModule })));
const CatalogModule = lazy(() => import("@/components/catalog/CatalogModule").then((m) => ({ default: m.CatalogModule })));
const ReportsModule = lazy(() => import("@/components/reports/ReportsModule").then((m) => ({ default: m.ReportsModule })));
const AuditModule = lazy(() => import("@/components/audit/AuditModule").then((m) => ({ default: m.AuditModule })));
const IAMModule = lazy(() => import("@/components/iam/IAMModule").then((m) => ({ default: m.IAMModule })));
const FinanceModule = lazy(() => import("@/components/finance/FinanceModule").then((m) => ({ default: m.FinanceModule })));
const HRModule = lazy(() => import("@/components/hr/HRModule").then((m) => ({ default: m.HRModule })));
const OrgModule = lazy(() => import("@/components/org/OrgModule").then((m) => ({ default: m.OrgModule })));
const SettingsModule = lazy(() => import("@/components/settings/SettingsModule").then((m) => ({ default: m.SettingsModule })));
const CRMModule = lazy(() => import("@/components/crm/CRMModule").then((m) => ({ default: m.CRMModule })));
const PromotionsModule = lazy(() => import("@/components/promotions/PromotionsModule").then((m) => ({ default: m.PromotionsModule })));
// SchedulingModule absorbed into WorkforceModule — redirect kept for backward compat
const WorkforceModule = lazy(() => import("@/components/workforce/WorkforceModule").then((m) => ({ default: m.WorkforceModule })));
const PosOrderGate = lazy(() => import("./routes/pos-order/guards/PosOrderGate"));

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

if (typeof window !== 'undefined') {
  const persister = createSyncStoragePersister({
    storage: window.localStorage,
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

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={(
        <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground">
          Loading module...
        </div>
      )}
    >
      {children}
    </Suspense>
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
    return <Navigate to="/dashboard" replace />;
  }
  return <Login />;
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

            <Route element={<ProtectedShell />}>
              <Route path="/dashboard" element={<LazyRoute><DashboardPage /></LazyRoute>} />
              <Route path="/pos" element={<LazyRoute><PosRoleRedirect><POSPage /></PosRoleRedirect></LazyRoute>} />
              <Route path="/order" element={<LazyRoute><CustomerOrdersPage /></LazyRoute>} />
              <Route path="/inventory" element={<LazyRoute><InventoryModule /></LazyRoute>} />
              <Route path="/procurement" element={<LazyRoute><ProcurementModule /></LazyRoute>} />
              <Route path="/catalog" element={<LazyRoute><CatalogModule /></LazyRoute>} />
              <Route path="/reports" element={<LazyRoute><ReportsModule /></LazyRoute>} />
              <Route path="/audit" element={<LazyRoute><AuditModule /></LazyRoute>} />
              <Route path="/iam" element={<LazyRoute><IAMModule /></LazyRoute>} />
              <Route path="/finance" element={<LazyRoute><FinanceModule /></LazyRoute>} />
              <Route path="/hr" element={<LazyRoute><HRModule /></LazyRoute>} />
              <Route path="/org" element={<Navigate to="/org/overview" replace />} />
              <Route path="/org/*" element={<LazyRoute><OrgModule /></LazyRoute>} />
              <Route path="/settings" element={<LazyRoute><SettingsModule /></LazyRoute>} />
              <Route path="/crm" element={<LazyRoute><CRMModule /></LazyRoute>} />
              <Route path="/promotions" element={<LazyRoute><PromotionsModule /></LazyRoute>} />
              <Route path="/scheduling" element={<Navigate to="/workforce" replace />} />
              <Route path="/workforce" element={<LazyRoute><WorkforceModule /></LazyRoute>} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/shell" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
