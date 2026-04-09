export type ShiftType = 'morning' | 'afternoon' | 'evening' | 'night' | 'split';
export type ShiftStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type AssignmentStatus = 'assigned' | 'confirmed' | 'checked_in' | 'checked_out' | 'missed';
export type SwapRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected';
export type TimeOffType = 'annual' | 'sick' | 'personal' | 'unpaid';

/** A shift is a time slot at an outlet — multiple employees can be assigned */
export interface Shift {
  id: string;
  outletId: string;
  outletName: string;
  date: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: ShiftStatus;
  notes?: string;
  assignments: ShiftAssignment[];
}

/** An employee assigned to a specific shift */
export interface ShiftAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  status: AssignmentStatus;
  overtimeMinutes: number;
}

// Keep legacy export for backward compat in swap/overtime tabs
export interface ShiftSchedule {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  outletId: string;
  outletName: string;
  date: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: string;
  notes?: string;
  overtimeMinutes: number;
  isOvertime: boolean;
}

export interface SwapRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  originalShiftId: string;
  originalDate: string;
  originalShift: string;
  targetShiftId: string;
  targetDate: string;
  targetShift: string;
  reason: string;
  status: SwapRequestStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  outletName: string;
  type: TimeOffType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: TimeOffStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface OvertimeSummary {
  employeeId: string;
  employeeName: string;
  outletName: string;
  periodStart: string;
  periodEnd: string;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  overtimeRate: number;
  overtimePay: number;
}
