import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi, type PosSessionView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';

export function usePosSession(outletId: string | null, currencyCode: string) {
  const { session } = useAuth();
  const token = session?.accessToken;
  const managerId = session?.user?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['pos-order-session', outletId, managerId],
    enabled: !!token && !!outletId,
    queryFn: async () => {
      const res = await salesApi.posSessions(token!, { outletId: outletId!, status: 'open', limit: 10 });
      const mine = res.items.find((s) => String(s.managerId) === String(managerId));
      return mine ?? res.items[0] ?? null;
    },
    staleTime: 10_000,
  });

  const openMutation = useMutation({
    mutationFn: async (payload: { sessionCode: string; openingCash: number; note?: string }) => {
      const today = new Date().toISOString().slice(0, 10);
      const opened = await salesApi.openPosSession(token!, {
        sessionCode: payload.sessionCode,
        outletId: outletId!,
        currencyCode,
        managerId: managerId!,
        businessDate: today,
        note: payload.note ?? null,
      });
      return opened;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-session', outletId, managerId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (sessionId: string) => salesApi.closePosSession(token!, sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-session', outletId, managerId] });
    },
  });

  const current: PosSessionView | null = query.data ?? null;

  return {
    session: current,
    needsOpenSession: !query.isLoading && !current,
    isLoading: query.isLoading,
    openSession: openMutation.mutateAsync,
    openSessionState: openMutation,
    closeSession: closeMutation.mutateAsync,
    closeSessionState: closeMutation,
  };
}
