import { deviceApi } from '@/api/device-api'

const STORAGE_KEY = 'fern-terminal-profile'
const JUST_PAIRED_KEY = 'fern-terminal-just-paired'

type StoredProfile = {
  registerCode: string
  displayName: string
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function loadProfile(): StoredProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredProfile
      if (parsed.registerCode && parsed.displayName) return parsed
    }
  } catch {
    // fall through to regenerate
  }
  const next = {
    registerCode: `POS-${randomSuffix()}`,
    displayName: `POS ${randomSuffix()}`,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export async function ensureTerminalPairing() {
  try {
    const { data } = await deviceApi.current()
    if (data.paired) return { ...data, pairedNow: false }
  } catch {
    // continue to pair
  }
  const profile = loadProfile()
  const { data } = await deviceApi.pair(profile)
  sessionStorage.setItem(JUST_PAIRED_KEY, '1')
  return { ...data, pairedNow: true }
}

export function consumeTerminalJustPaired(): boolean {
  const value = sessionStorage.getItem(JUST_PAIRED_KEY) === '1'
  sessionStorage.removeItem(JUST_PAIRED_KEY)
  return value
}
