import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { PosSessionCache } from '@/db/schema'

interface SessionState {
  current: PosSessionCache | null
  deviceId: string | null
  workerId: number | null
  registerCode: string | null
  registerDisplayName: string | null
  bootstrapping: boolean
  bootstrapped: boolean
}

const initialState: SessionState = {
  current: null,
  deviceId: null,
  workerId: null,
  registerCode: null,
  registerDisplayName: null,
  bootstrapping: false,
  bootstrapped: false,
}

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    setSession(state, action: PayloadAction<PosSessionCache>) {
      state.current = action.payload
      state.bootstrapping = false
      state.bootstrapped = true
    },
    clearSession(state) {
      state.current = null
    },
    setDevice(state, action: PayloadAction<{ deviceId: string | null; workerId: number | null; registerCode?: string | null; registerDisplayName?: string | null }>) {
      state.deviceId = action.payload.deviceId
      state.workerId = action.payload.workerId
      state.registerCode = action.payload.registerCode ?? null
      state.registerDisplayName = action.payload.registerDisplayName ?? null
    },
    sessionBootstrapStarted(state) {
      state.bootstrapping = true
      state.bootstrapped = false
    },
    sessionBootstrapComplete(state) {
      state.bootstrapping = false
      state.bootstrapped = true
    },
  },
})

export const {
  setSession,
  clearSession,
  setDevice,
  sessionBootstrapStarted,
  sessionBootstrapComplete,
} = sessionSlice.actions
export default sessionSlice.reducer
