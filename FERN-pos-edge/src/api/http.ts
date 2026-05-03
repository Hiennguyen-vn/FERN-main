import axios from 'axios'

/**
 * PWA talks to the local Node agent at port 8099 instead of FERN central gateway.
 * Agent serves /api/v1/* from local Postgres, replays outbox upstream asynchronously.
 * Override via VITE_AGENT_URL for integration tests.
 */
const defaultAgentBase =
  typeof window === 'undefined'
    ? 'http://localhost:8099'
    : `${window.location.protocol}//${window.location.hostname}:8099`

export const AGENT_BASE = import.meta.env.VITE_AGENT_URL ?? defaultAgentBase

export const http = axios.create({
  baseURL: `${AGENT_BASE}/api/v1`,
  withCredentials: true,
  timeout: 5_000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      window.dispatchEvent(new CustomEvent('pos:unauthorized'))
    }
    return Promise.reject(err)
  }
)
