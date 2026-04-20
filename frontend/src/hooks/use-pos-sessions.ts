import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/api/decoders';
import { orgApi, salesApi, type PosSessionView } from '@/api/fern-api';
import { useAuth } from '@/auth/use-auth';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { normalizeNumericId } from '@/constants/pos';

export interface DBPosSession {
  id: string;
  outlet_id: string;
  currency_code: string | null;
  operator_id: string;
  status: string;
  opening_float: number;
  closing_cash: number | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  outlet_name?: string;
  order_count: number;
  total_revenue: number;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function mapPosSession(apiSession: PosSessionView, outletNameById: Map<string, string>): DBPosSession {
  const outletId = String(apiSession.outletId ?? '');
  const openedAt = String(apiSession.openedAt ?? new Date().toISOString());
  const closedAt = apiSession.closedAt ? String(apiSession.closedAt) : null;

  return {
    id: String(apiSession.id),
    outlet_id: outletId,
    currency_code: apiSession.currencyCode == null ? null : String(apiSession.currencyCode),
    operator_id: String(apiSession.managerId ?? ''),
    status: String(apiSession.status ?? 'open'),
    opening_float: 0,
    closing_cash: null,
    notes: apiSession.note == null ? null : String(apiSession.note),
    opened_at: openedAt,
    closed_at: closedAt,
    created_at: openedAt,
    updated_at: closedAt || openedAt,
    outlet_name: outletNameById.get(outletId) || 'Unknown',
    order_count: typeof apiSession.orderCount === 'number' ? apiSession.orderCount : 0,
    total_revenue: typeof apiSession.totalRevenue === 'number' ? apiSession.totalRevenue : 0,
  };
}

export function usePOSSessions() {
  const { token, scope } = useShellRuntime();
  const { session: authSession } = useAuth();
  const [sessions, setSessions] = useState<DBPosSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    if (!token) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const scopedOutletId = normalizeNumericId(scope.outletId);
      const [outlets, page] = await Promise.all([
        orgApi.outlets(token),
        salesApi.posSessions(token, {
          outletId: scopedOutletId || undefined,
          limit: 100,
          offset: 0,
        }),
      ]);

      const outletNameById = new Map(outlets.map((outlet) => [outlet.id, outlet.name]));
      const mapped = (page.items || []).map((session) => mapPosSession(session, outletNameById));
      setSessions(mapped);
    } catch (error) {
      console.error('Error fetching POS sessions:', error);
      toast.error('Unable to load POS sessions');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [scope.outletId, token]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const createSession = async (outletId: string, _openingFloat: number, notes?: string) => {
    if (!token) {
      toast.error('Please sign in first');
      return null;
    }

    const managerId = normalizeNumericId(authSession?.user.id);
    const scopedOutletId = normalizeNumericId(outletId);
    if (!managerId || !scopedOutletId) {
      toast.error('Unable to open session: invalid manager/outlet identifiers');
      return null;
    }

    const businessDate = new Date().toISOString().slice(0, 10);
    const sessionCode = `POS-${businessDate.replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

    try {
      const created = toRecord(await salesApi.openPosSession(token, {
        sessionCode,
        outletId: scopedOutletId,
        currencyCode: 'USD',
        managerId,
        businessDate,
        note: notes || null,
      }));
      if (created?.id == null) {
        throw new Error('POS session response is missing id');
      }

      toast.success('POS session opened');
      await fetchSessions();
      return { id: String(created.id) };
    } catch (error) {
      console.error('Create session failed:', error);
      toast.error(getErrorMessage(error, 'Unable to open POS session'));
      return null;
    }
  };

  const updateSession = async (_id: string, _updates: {
    status?: string;
    closing_cash?: number | null;
    closed_at?: string | null;
    notes?: string | null;
    opening_float?: number;
  }) => {
    toast.error('POS session edits are not exposed by backend APIs yet');
    return false;
  };

  const closeSession = async (id: string, closingCash: number) => {
    if (!token) {
      toast.error('Please sign in first');
      return false;
    }
    try {
      await salesApi.closePosSession(token, id, {
        note: closingCash > 0 ? `Closing cash: ${closingCash.toFixed(2)}` : undefined,
      });
      toast.success('Session closed');
      await fetchSessions();
      return true;
    } catch (error) {
      console.error('Close session failed:', error);
      toast.error('Unable to close POS session');
      return false;
    }
  };

  const reconcileSession = async (
    id: string,
    payload?: {
      lines?: Array<{ paymentMethod: string; actualAmount: number }>;
      note?: string;
    },
  ) => {
    if (!token) {
      toast.error('Please sign in first');
      return false;
    }
    try {
      await salesApi.reconcilePosSession(token, id, payload);
      toast.success('Session reconciled');
      await fetchSessions();
      return true;
    } catch (error: unknown) {
      console.error('Reconcile session failed:', error);
      toast.error(getErrorMessage(error, 'Unable to reconcile session'));
      return false;
    }
  };

  const deleteSession = async (_id: string) => {
    toast.error('Session deletion is not available in backend APIs');
    return false;
  };

  return {
    sessions,
    loading,
    fetchSessions,
    createSession,
    updateSession,
    closeSession,
    reconcileSession,
    deleteSession,
  };
}
