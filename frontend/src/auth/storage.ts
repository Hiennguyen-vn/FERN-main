import type { AuthSession } from '@/api/fern-api';

export function readStoredSession(): AuthSession | null {
  return null;
}

export function writeStoredSession(session: AuthSession) {
  void session;
}

export function clearStoredSession() {
}
