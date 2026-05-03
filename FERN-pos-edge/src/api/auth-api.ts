import { http } from './http'

export interface LoginRequest {
  username: string
  pin?: string
  password?: string
}

export interface LoginResponse {
  local?: boolean
  offline?: boolean
  offline_grace_until?: string | null
  user?: {
    id: number | string
    username: string
    display_name?: string | null
    role?: string
  }
  scopes?: Array<{ outlet_id: string; role: string }>
}

export interface MeResponse {
  id: number
  username: string
  display_name: string
  scopes: Array<{ outlet_id: string; role: string }>
}

export interface LeaseOfflineResponse {
  offline_grace_until: string  // ISO timestamp
}

export const authApi = {
  login: (body: LoginRequest) =>
    http.post<LoginResponse>('/auth/login', body),

  me: () =>
    http.get<MeResponse>('/auth/me'),

  logout: () =>
    http.post<void>('/auth/logout'),

  leaseOffline: () =>
    http.post<LeaseOfflineResponse>('/auth/lease-offline'),
}
