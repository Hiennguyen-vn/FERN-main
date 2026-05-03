import { http } from './http'

export interface LocalDeviceResponse {
  device_id: string | null
  worker_id: number | null
  outlet_id: string
  register_code: string | null
  display_name: string | null
  paired_at?: string | null
  paired?: boolean
}

export interface HubPairResponse {
  device_id: string
  outlet_id: string
  worker_id: number | null
  paired_at: string
}

export const deviceApi = {
  current: () =>
    http.get<LocalDeviceResponse>('/local/device/me'),

  pair: (body: { registerCode?: string; displayName?: string }) =>
    http.post<LocalDeviceResponse>('/local/device/pair', body),

  pairHub: (body: { pairToken: string }) =>
    http.post<HubPairResponse>('/devices/pair', { pair_token: body.pairToken }),
}
