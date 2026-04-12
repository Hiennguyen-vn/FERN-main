import type { CreateWorkShiftPayload } from '@/api/fern-api';

export interface WorkShiftAssignmentBatchDraft {
  shiftId: string;
  workDate: string;
  note?: string | null;
  userIds: string[];
}

export interface ExistingWorkShiftAssignment {
  shiftId: string;
  userId: string;
  workDate: string;
}

export interface WorkShiftAssignmentPlan {
  payloads: CreateWorkShiftPayload[];
  duplicateUserIds: string[];
}

function normalizeUserIds(userIds: string[]) {
  return Array.from(new Set(userIds.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function planWorkShiftAssignments(
  draft: WorkShiftAssignmentBatchDraft,
  existingAssignments: ExistingWorkShiftAssignment[] = [],
): WorkShiftAssignmentPlan {
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

  const existingKeys = new Set(
    existingAssignments.map((assignment) => [
      String(assignment.shiftId || '').trim(),
      String(assignment.userId || '').trim(),
      String(assignment.workDate || '').trim(),
    ].join(':')),
  );

  const duplicateUserIds: string[] = [];
  const payloads = userIds.flatMap((userId) => {
    const key = [shiftId, userId, workDate].join(':');
    if (existingKeys.has(key)) {
      duplicateUserIds.push(userId);
      return [];
    }
    return [{
      userId,
      shiftId,
      workDate,
      note: note || null,
    }];
  });

  return { payloads, duplicateUserIds };
}

export function buildWorkShiftAssignmentPayloads(draft: WorkShiftAssignmentBatchDraft): CreateWorkShiftPayload[] {
  return planWorkShiftAssignments(draft).payloads;
}
