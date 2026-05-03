import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface AuthState {
  userId: number | null
  displayName: string | null
  outletId: string | null
  scopes: string[]
  offlineGraceUntil: number | null  // ms epoch
  isAuthenticated: boolean
  /** True when current session was authenticated via cached offline credential. */
  isOfflineSession: boolean
  bootstrapped: boolean
}

const initialState: AuthState = {
  userId: null,
  displayName: null,
  outletId: null,
  scopes: [],
  offlineGraceUntil: null,
  isAuthenticated: false,
  isOfflineSession: false,
  bootstrapped: false,
}

type AuthSessionPayload = Omit<AuthState, 'isAuthenticated' | 'isOfflineSession' | 'bootstrapped'>

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess(state, action: PayloadAction<AuthSessionPayload>) {
      Object.assign(state, action.payload)
      state.isAuthenticated = true
      state.isOfflineSession = false
      state.bootstrapped = true
    },
    offlineLoginSuccess(state, action: PayloadAction<AuthSessionPayload>) {
      Object.assign(state, action.payload)
      state.isAuthenticated = true
      state.isOfflineSession = true
      state.bootstrapped = true
    },
    logout(state) {
      Object.assign(state, initialState)
      state.bootstrapped = true
    },
    setOfflineGrace(state, action: PayloadAction<number>) {
      state.offlineGraceUntil = action.payload
    },
    authBootstrapComplete(state) {
      state.bootstrapped = true
    },
  },
})

export const { loginSuccess, offlineLoginSuccess, logout, setOfflineGrace, authBootstrapComplete } = authSlice.actions
export default authSlice.reducer

/**
 * Selector — true while the offline grace window is still valid for the active session.
 * Use this in route guards instead of comparing offlineGraceUntil ad-hoc.
 */
export function selectOfflineGraceActive(state: { auth: AuthState }, now: number = Date.now()): boolean {
  const until = state.auth.offlineGraceUntil
  return until != null && now <= until
}
