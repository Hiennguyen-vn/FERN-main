import { useEffect } from 'react';
import type { AuthSession } from '@/api/fern-api';

interface UseAuthSessionTimerOptions {
  session: AuthSession | null;
  onRefresh: () => void;
}

export function useAuthSessionTimer({ session, onRefresh }: UseAuthSessionTimerOptions) {
  useEffect(() => {
    if (!session?.expiresAt) return;

    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt)) return;

    const msUntilRefresh = Math.max(10_000, expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      onRefresh();
    }, msUntilRefresh);

    return () => window.clearTimeout(timer);
  }, [onRefresh, session]);
}
