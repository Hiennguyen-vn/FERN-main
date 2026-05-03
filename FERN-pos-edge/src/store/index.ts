import { configureStore } from '@reduxjs/toolkit'
import cartReducer from './cart.slice'
import sessionReducer from './session.slice'
import syncReducer from './sync.slice'
import authReducer from './auth.slice'
import networkReducer from './network.slice'

export const store = configureStore({
  reducer: {
    cart: cartReducer,
    session: sessionReducer,
    sync: syncReducer,
    auth: authReducer,
    network: networkReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // outbox payloads may include generated IDs as strings
        ignoredActionPaths: ['payload.event_id', 'payload.id'],
      },
    }),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
