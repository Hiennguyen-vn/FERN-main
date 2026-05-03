import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

type SyncStatus = 'idle' | 'syncing' | 'error'

interface SyncState {
  outboxDepth: number
  lastFlushAt: number | null
  lastCatalogSyncAt: number | null
  lastStockSyncAt: number | null
  status: SyncStatus
  error: string | null
}

const initialState: SyncState = {
  outboxDepth: 0,
  lastFlushAt: null,
  lastCatalogSyncAt: null,
  lastStockSyncAt: null,
  status: 'idle',
  error: null,
}

const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    setOutboxDepth(state, action: PayloadAction<number>) {
      state.outboxDepth = action.payload
    },
    setSyncing(state) {
      state.status = 'syncing'
      state.error = null
    },
    setSyncDone(state, action: PayloadAction<{ type: 'catalog' | 'stock' | 'outbox' }>) {
      state.status = 'idle'
      const now = Date.now()
      if (action.payload.type === 'catalog') state.lastCatalogSyncAt = now
      if (action.payload.type === 'stock') state.lastStockSyncAt = now
      if (action.payload.type === 'outbox') state.lastFlushAt = now
    },
    setSyncError(state, action: PayloadAction<string>) {
      state.status = 'error'
      state.error = action.payload
    },
  },
})

export const { setOutboxDepth, setSyncing, setSyncDone, setSyncError } = syncSlice.actions
export default syncSlice.reducer
