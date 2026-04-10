import type { CreateWorkShiftPayload } from '@/api/fern-api';

export interface WorkShiftAssignmentBatchDraft {
  shiftId: string;
  workDate: string;
  note?: string | null;
  userIds: string[];
}

function normalizeUserIds(userIds: string[]) {
  return Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function buildWorkShiftAssignmentPayloads(draft: WorkShiftAssignmentBatchDraft): CreateWorkShiftPayload[] {
  const shiftId = String(draft.shiftId || '').trim();
  const workDate = String(draft.workDate || '').trim();
  const userIds = normalizeUserIds(draft.userIds || []);
  const note = String(draft.note || '').trim();

  if (!shiftId) {
    throw new Error('Select a shift before assigning');
  }
  if (!workDate) {
    throw new Error('Select a work date before assigning');
  }
  if (userIds.length === 0) {
    throw new Error('Select at least one employee before assigning');
  }

  return userIds.map((userId) => ({
    userId,
    shiftId,
    workDate,
    note: note || null,
  }));
}
