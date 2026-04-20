import { useCallback, useEffect, useState } from 'react';
import type { CartLine, OrderType } from './use-pos-cart';

export interface DraftOrder {
  draftId: string;
  orderNo: string;
  savedAt: string;
  orderType: OrderType;
  customerName: string;
  lines: CartLine[];
}

const STORAGE_KEY = 'pos-order-drafts-v2';

function load(): DraftOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DraftOrder[]) : [];
  } catch {
    return [];
  }
}

function persist(drafts: DraftOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* ignore */ }
}

export function useDraftOrders() {
  const [drafts, setDrafts] = useState<DraftOrder[]>(load);

  useEffect(() => {
    persist(drafts);
  }, [drafts]);

  const saveDraft = useCallback((d: Omit<DraftOrder, 'draftId' | 'savedAt'>) => {
    const entry: DraftOrder = {
      ...d,
      draftId: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
    };
    setDrafts((prev) => [entry, ...prev].slice(0, 20));
    return entry.draftId;
  }, []);

  const updateDraft = useCallback((draftId: string, patch: Partial<Pick<DraftOrder, 'lines' | 'orderType' | 'customerName'>>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.draftId === draftId ? { ...d, ...patch, savedAt: new Date().toISOString() } : d)),
    );
  }, []);

  const deleteDraft = useCallback((draftId: string) => {
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
  }, []);

  return { drafts, saveDraft, updateDraft, deleteDraft };
}
