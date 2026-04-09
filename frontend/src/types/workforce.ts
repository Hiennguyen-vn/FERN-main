// Workforce module types

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
  rate: number; // multiplier e.g. 1.5x
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
