import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/fern-api';
import { ApiError } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/auth/auth-context';
import { useAuthSessionTimer } from '@/auth/auth-session-timer';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof authApi.me>> | null>(null);
  const queryClient = useQueryClient();

  const bootstrap = useQuery({
    queryKey: ['auth', 'bootstrap'],
    retry: false,
    queryFn: async () => {
      try {
        const nextSession = await authApi.me();
        setSession(nextSession);
        return nextSession;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setSession(null);
          return null;
        }
        throw error;
      }
    },
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.invalidateQueries();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => authApi.refresh(session?.accessToken),
    onSuccess: (nextSession) => {
      if (!nextSession) return;
      setSession(nextSession);
    },
    onError: () => {
      setSession(null);
      queryClient.clear();
    },
  });

  useAuthSessionTimer({
    session,
    onRefresh: () => {
      refreshMutation.mutate();
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading:
        (bootstrap.isLoading && !session) ||
        loginMutation.isPending ||
        refreshMutation.isPending,
      login: async (username, password) => {
        await loginMutation.mutateAsync({ username, password });
      },
      logout: async () => {
        try {
          if (session) {
            await authApi.logout(session.accessToken);
          }
        } finally {
          setSession(null);
          queryClient.clear();
        }
      },
      refreshSession: async () => {
        await refreshMutation.mutateAsync();
      },
    }),
    [
      bootstrap.isLoading,
      loginMutation,
      queryClient,
      refreshMutation,
      session,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
