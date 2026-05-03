import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { logout } from '@/store/auth.slice'
import { selectOfflineGraceActive } from '@/store/auth.slice'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch()
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated)
  const bootstrapped = useAppSelector(s => s.auth.bootstrapped)
  const isOfflineSession = useAppSelector(s => s.auth.isOfflineSession)
  const graceActive = useAppSelector(s => selectOfflineGraceActive(s))

  // Offline session whose grace window expired → force logout
  useEffect(() => {
    if (isAuthenticated && isOfflineSession && !graceActive) {
      dispatch(logout())
    }
  }, [isAuthenticated, isOfflineSession, graceActive, dispatch])

  if (!bootstrapped) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isOfflineSession && !graceActive) return <Navigate to="/login" replace />
  return <>{children}</>
}
