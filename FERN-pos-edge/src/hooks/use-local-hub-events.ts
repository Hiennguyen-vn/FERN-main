import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AGENT_BASE, http } from '@/api/http'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { setServerReachable } from '@/store/network.slice'
import { setOutboxDepth, setSyncDone, setSyncError } from '@/store/sync.slice'
import { refreshCurrentSession, refreshPairedDevice } from '@/hooks/use-session'

type HubEvent = {
  type?: string
  payload?: Record<string, unknown> | null
}

type ManifestResponse = {
  outbox: { pending: number; stale_syncing?: number; failed: number }
}

async function refreshManifest(dispatch: ReturnType<typeof useAppDispatch>) {
  const { data } = await http.get<ManifestResponse>('/sync/manifest')
  dispatch(setOutboxDepth(
    data.outbox.pending + (data.outbox.stale_syncing ?? 0) + data.outbox.failed,
  ))
  dispatch(setSyncDone({ type: 'outbox' }))
  window.dispatchEvent(new CustomEvent('hub:manifest-invalidated'))
}

export function useLocalHubEvents() {
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()
  const auth = useAppSelector(state => state.auth)

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.outletId) return

    let closed = false
    let reconnectTimer: number | null = null
    let eventSource: EventSource | null = null

    const reconnect = () => {
      if (closed || reconnectTimer != null) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 1500)
    }

    const syncSession = async () => {
      const registerCode = await refreshPairedDevice(dispatch)
      await refreshCurrentSession(dispatch, auth.outletId!, registerCode)
    }

    const handleHubEvent = async (event: MessageEvent<string>) => {
      const parsed: HubEvent = JSON.parse(event.data)
      switch (parsed.type) {
        case 'connected':
          dispatch(setServerReachable(true))
          window.dispatchEvent(new CustomEvent('hub:reachability', { detail: { reachable: true } }))
          await refreshManifest(dispatch)
          break
        case 'device.paired':
          await syncSession()
          queryClient.invalidateQueries({ queryKey: ['menus'] })
          break
        case 'menu.updated':
          queryClient.invalidateQueries({ queryKey: ['menus'] })
          queryClient.invalidateQueries({ queryKey: ['menu'] })
          dispatch(setSyncDone({ type: 'catalog' }))
          break
        case 'inventory.updated':
          dispatch(setSyncDone({ type: 'stock' }))
          break
        case 'session.updated':
          await syncSession()
          break
        case 'sync.updated':
          await refreshManifest(dispatch)
          break
        default:
          break
      }
    }

    const connect = async () => {
      try {
        await syncSession()
        await refreshManifest(dispatch)
        dispatch(setServerReachable(true))
        window.dispatchEvent(new CustomEvent('hub:reachability', { detail: { reachable: true } }))
      } catch (error) {
        dispatch(setServerReachable(false))
        dispatch(setSyncError((error as Error).message ?? 'hub_unreachable'))
        window.dispatchEvent(new CustomEvent('hub:reachability', { detail: { reachable: false } }))
      }

      if (closed) return
      eventSource = new EventSource(`${AGENT_BASE}/api/local/events`, { withCredentials: true })
      eventSource.addEventListener('connected', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.addEventListener('device.paired', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.addEventListener('menu.updated', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.addEventListener('inventory.updated', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.addEventListener('session.updated', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.addEventListener('sync.updated', event => { void handleHubEvent(event as MessageEvent<string>) })
      eventSource.onerror = () => {
        dispatch(setServerReachable(false))
        dispatch(setSyncError('hub_sse_disconnected'))
        window.dispatchEvent(new CustomEvent('hub:reachability', { detail: { reachable: false } }))
        eventSource?.close()
        eventSource = null
        reconnect()
      }
    }

    void connect()

    return () => {
      closed = true
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
      }
      eventSource?.close()
    }
  }, [auth.isAuthenticated, auth.outletId, dispatch, queryClient])
}
