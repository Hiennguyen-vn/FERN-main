import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Provider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { store } from '@/store'
import LoginPage from '@/routes/login'
import OrderPage from '@/routes/order'
import OpenShiftPage from '@/routes/open-shift'
import CloseShiftPage from '@/routes/close-shift'
import WastePage from '@/routes/waste'
import StockInPage from '@/routes/stock-in'
import SyncCenterPage from '@/routes/sync-center'
import AuthGuard from '@/components/auth-guard'
import { SwUpdateBanner } from '@/components/sw-update-banner'
import { useLocalHubEvents } from '@/hooks/use-local-hub-events'
import { useSessionBootstrap } from '@/hooks/use-session'
import { useCartPersist } from '@/hooks/use-cart-persist'
import { useOfflineGraceCheck } from '@/hooks/use-offline-grace-check'
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap'
import { queryClient } from '@/lib/query-client'

function AppShell() {
  useAuthBootstrap()
  useSessionBootstrap()
  useLocalHubEvents()
  useCartPersist()
  useOfflineGraceCheck()

  return (
    <>
      <SwUpdateBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/open-shift"
          element={
            <AuthGuard>
              <OpenShiftPage />
            </AuthGuard>
          }
        />
        <Route
          path="/close-shift"
          element={
            <AuthGuard>
              <CloseShiftPage />
            </AuthGuard>
          }
        />
        <Route
          path="/order"
          element={
            <AuthGuard>
              <OrderPage />
            </AuthGuard>
          }
        />
        <Route
          path="/waste"
          element={
            <AuthGuard>
              <WastePage />
            </AuthGuard>
          }
        />
        <Route
          path="/stock-in"
          element={
            <AuthGuard>
              <StockInPage />
            </AuthGuard>
          }
        />
        <Route
          path="/sync-center"
          element={
            <AuthGuard>
              <SyncCenterPage />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/order" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </QueryClientProvider>
    </Provider>
  )
}
