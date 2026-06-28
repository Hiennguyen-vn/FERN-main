import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { todayLocalISO } from '@/lib/date-format';
import { salesApi, type PosSessionView } from '@/api/sales-api';
import { useAuth } from '@/auth/use-auth';

/** Only bind the cashier to their own open session — never adopt another user's shift. */
export function pickOpenSessionForManager(
  sessions: PosSessionView[],
  managerId: string | number | null | undefined,
): PosSessionView | null {
  if (managerId == null || managerId === '') return null;
  return sessions.find((s) => String(s.managerId) === String(managerId)) ?? null;
}

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
      return pickOpenSessionForManager(res.items, managerId);
    },
    staleTime: 10_000,
  });

  const openMutation = useMutation({
    mutationFn: async (payload: { sessionCode: string; openingCash: number; note?: string }) => {
      const today = todayLocalISO();
      const opened = await salesApi.openPosSession(token!, {
        sessionCode: payload.sessionCode,
        outletId: outletId!,
        currencyCode,
        managerId: managerId!,
        businessDate: today,
        note: payload.note ?? null,
      });
      if (payload.openingCash > 0) {
        await salesApi.recordCashMovement(token!, opened.id, {
          type: 'OPEN_FLOAT',
          amount: payload.openingCash,
          reason: payload.note?.trim() || 'Tiền đầu ca',
        });
      }
      return { opened, openingCash: payload.openingCash };
    },
    onSuccess: ({ opened, openingCash }) => {
      sessionStorage.setItem(`pos-opening-cash-${opened.id}`, String(openingCash));
      qc.invalidateQueries({ queryKey: ['pos-order-session', outletId, managerId] });
      qc.invalidateQueries({ queryKey: ['pos-shift-close-summary'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (sessionId: string) => salesApi.closePosSession(token!, sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-order-session', outletId, managerId] });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async (args: {
      sessionId: string;
      lines: Array<{ paymentMethod: string; actualAmount: number }>;
      note?: string;
    }) => salesApi.reconcilePosSession(token!, args.sessionId, {
      lines: args.lines,
      note: args.note,
    }),
    onSuccess: (_data, variables) => {
      sessionStorage.removeItem(`pos-opening-cash-${variables.sessionId}`);
      qc.invalidateQueries({ queryKey: ['pos-order-session', outletId, managerId] });
      qc.invalidateQueries({ queryKey: ['pos-order-feed'] });
      qc.invalidateQueries({ queryKey: ['pos-shift-close-summary'] });
      qc.invalidateQueries({ queryKey: ['pos-cash-summary'] });
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
    reconcileSession: reconcileMutation.mutateAsync,
    reconcileSessionState: reconcileMutation,
  };
}
