import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface NetworkState {
  online: boolean
  serverReachable: boolean
  lastSeenOnlineAt: number | null
  clockAnchor: { serverTimeMs: number; monotonicRef: number } | null
}

const initialState: NetworkState = {
  online: navigator.onLine,
  serverReachable: false,
  lastSeenOnlineAt: null,
  clockAnchor: null,
}

const networkSlice = createSlice({
  name: 'network',
  initialState,
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
      if (action.payload) state.lastSeenOnlineAt = Date.now()
    },
    setServerReachable(state, action: PayloadAction<boolean>) {
      state.serverReachable = action.payload
    },
    setClockAnchor(state, action: PayloadAction<{ serverTimeMs: number; monotonicRef: number }>) {
      state.clockAnchor = action.payload
    },
  },
})

export const { setOnline, setServerReachable, setClockAnchor } = networkSlice.actions
export default networkSlice.reducer
