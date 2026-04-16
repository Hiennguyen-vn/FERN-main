// Workforce module types

// ── Work roles within a shift (NOT business/IAM roles) ──
export type WorkRole = 'cashier' | 'kitchen_staff' | 'prep' | 'support' | 'closing_support';
export type Daypart = 'opening' | 'breakfast' | 'lunch_peak' | 'afternoon' | 'closing';

// ── Derived statuses (computed on frontend, not stored in DB) ──
export type LiveStatus =
  | 'assigned' | 'confirmed' | 'checked_in' | 'late'
  | 'no_show' | 'on_leave' | 'completed' | 'cancelled';

export type ShiftProgress = 'not_started' | 'in_progress' | 'completed';

// ── Exception types (derived on frontend) ──
export type ExceptionType = 'no_show' | 'late' | 'unfilled' | 'overtime_risk';
export type ExceptionSeverity = 'critical' | 'warning' | 'info';

export interface DerivedException {
  type: ExceptionType;
  severity: ExceptionSeverity;
  employeeId?: string;
  employeeName?: string;
  workShiftId?: string;
  shiftId: string;
  shiftName: string;
  workRole?: string;
  detail: string;
}

// ── Role coverage (computed) ──
export interface RoleCoverage {
  workRole: string;
  required: number;
  assigned: number;
  checkedIn: number;
}

// ── Daily board metrics (computed) ──
export interface DailyBoardMetrics {
  onFloor: number;
  totalAssigned: number;
  coveragePercent: number;
  lateCount: number;
  noShowCount: number;
  pendingReview: number;
}

// ── Day summary for Labor Review ──
export interface DaySummary {
  date: string;
  scheduledHours: number;
  actualHours: number;
  variance: number;
  overtimeHours: number;
  lateCount: number;
  absentCount: number;
  approvedCount: number;
  totalCount: number;
}

// ── Legacy types (kept for backward compat) ──
export type AttendanceStatus = 'checked_in' | 'checked_out' | 'absent' | 'late' | 'on_leave';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  outletId: string;
  outletName: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  scheduledIn: string;
  scheduledOut: string;
  status: AttendanceStatus;
  lateMinutes: number;
  overtimeMinutes: number;
  notes?: string;
}

export type OvertimeStatus = 'pending' | 'approved' | 'rejected';

export interface OvertimeRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  outletId: string;
  outletName: string;
  date: string;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  rate: number;
  estimatedPay: number;
  status: OvertimeStatus;
  approvedBy?: string;
  reason?: string;
}

export type LeaveType = 'annual' | 'sick' | 'personal' | 'maternity' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  outletId: string;
  outletName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  createdAt: string;
}

export interface LeaveQuota {
  employeeId: string;
  employeeName: string;
  outletName: string;
  annual: { total: number; used: number; remaining: number };
  sick: { total: number; used: number; remaining: number };
  personal: { total: number; used: number; remaining: number };
}
