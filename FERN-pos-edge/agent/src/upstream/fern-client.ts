import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import JSONBig from 'json-bigint'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'

const TOKEN_FILE = path.resolve(config.DEVICE_TOKEN_FILE)
const JSONBigStr = JSONBig({ storeAsString: true })

interface StoredToken {
  token: string
  expiresAt: string // ISO
}

function loadToken(): StoredToken | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8')
    return JSON.parse(raw) as StoredToken
  } catch {
    return null
  }
}

function saveToken(t: StoredToken): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), 'utf8')
}

function tokenIsExpiringSoon(t: StoredToken): boolean {
  const expiresAt = new Date(t.expiresAt).getTime()
  return Date.now() > expiresAt - 7 * 24 * 3600 * 1000 // refresh 7 days before expiry
}

export function deviceTokenStatus(): { paired: boolean; expiresAt: string | null; expiringSoon: boolean } {
  const stored = loadToken()
  if (!stored) {
    return { paired: false, expiresAt: null, expiringSoon: false }
  }
  return {
    paired: true,
    expiresAt: stored.expiresAt,
    expiringSoon: tokenIsExpiringSoon(stored),
  }
}

let refreshInFlight: Promise<string> | null = null

async function getDeviceToken(client: AxiosInstance): Promise<string | null> {
  const stored = loadToken()
  if (!stored) return null

  if (!tokenIsExpiringSoon(stored)) return stored.token

  // Refresh proactively
  if (!refreshInFlight) {
    refreshInFlight = client
      .post<{ deviceToken: string; expiresAt: string }>(
        '/api/v1/devices/refresh',
        {},
        { headers: { Authorization: `Bearer ${stored.token}` } }
      )
      .then(r => {
        const next: StoredToken = { token: r.data.deviceToken, expiresAt: r.data.expiresAt }
        saveToken(next)
        logger.info('device token refreshed')
        return next.token
      })
      .catch(err => {
        logger.warn({ err: String(err) }, 'device token refresh failed, continuing with old token')
        return stored.token
      })
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export const fernClient: AxiosInstance = axios.create({
  baseURL: config.FERN_GATEWAY_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  transformResponse: [(data: string) => {
    if (!data) return data
    try {
      return JSONBigStr.parse(data)
    } catch {
      return data
    }
  }],
})

// Attach the mini-server device JWT for central sync. Public pair/provision calls
// either carry an operator Authorization header explicitly or are intentionally public.
fernClient.interceptors.request.use(async (reqConfig: InternalAxiosRequestConfig) => {
  const path = String(reqConfig.url ?? '')
  const hasAuthorization = reqConfig.headers.has('Authorization')
  if (hasAuthorization || path.includes('/api/v1/devices/pair')) {
    return reqConfig
  }
  const token = await getDeviceToken(fernClient)
  if (!token) {
    throw new Error('device_token_required')
  }
  reqConfig.headers.set('Authorization', `Bearer ${token}`)
  reqConfig.headers.delete('X-Internal-Token')
  reqConfig.headers.delete('X-Internal-Service')
  reqConfig.headers.delete('X-Internal-Outlet-Ids')
  return reqConfig
})

fernClient.interceptors.response.use(
  r => r,
  err => {
    logger.warn({ url: err.config?.url, status: err.response?.status, msg: err.message }, 'fern upstream error')
    return Promise.reject(err)
  }
)

/** Called by devices.ts after redeeming a pair token. */
export function persistDeviceToken(token: string, expiresAt: string): void {
  saveToken({ token, expiresAt })
}
