import { describe, expect, it } from 'vitest';
import { pickOpenSessionForManager } from '@/routes/pos-order/hooks/use-pos-session';
import type { PosSessionView } from '@/api/sales-api';

describe('pickOpenSessionForManager', () => {
  const sessions: PosSessionView[] = [
    { id: '1', managerId: '100', sessionCode: 'POS-A' },
    { id: '2', managerId: '200', sessionCode: 'POS-B' },
  ];

  it('returns the open session owned by the current cashier', () => {
    expect(pickOpenSessionForManager(sessions, '100')?.id).toBe('1');
    expect(pickOpenSessionForManager(sessions, 200)?.id).toBe('2');
  });

  it('does not adopt another cashier open session', () => {
    expect(pickOpenSessionForManager(sessions, '999')).toBeNull();
    expect(pickOpenSessionForManager(sessions, '300')).toBeNull();
  });

  it('returns null when manager id is missing', () => {
    expect(pickOpenSessionForManager(sessions, null)).toBeNull();
    expect(pickOpenSessionForManager(sessions, undefined)).toBeNull();
    expect(pickOpenSessionForManager(sessions, '')).toBeNull();
  });

  it('returns null when no sessions are open', () => {
    expect(pickOpenSessionForManager([], '100')).toBeNull();
  });
});
