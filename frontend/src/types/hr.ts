// HR / Workforce types — Wave 2

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave' | 'half_day';
export type ExceptionType = 'late_arrival' | 'early_departure' | 'missed_clock_out' | 'overtime' | 'no_show' | 'none';
export type ApprovalStatus = 'pending_review' | 'approved' | 'flagged' | 'auto_approved';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  outletId: string;
  outletName: string;
  date: string;
  scheduledShift: string;
  clockIn?: string;
  clockOut?: string;
  attendanceStatus: AttendanceStatus;
  exception: ExceptionType;
  exceptionMinutes?: number;
  approvalStatus: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
}

// Contract Management types
export type ContractType = 'probation' | 'fixed_term' | 'indefinite' | 'seasonal' | 'part_time';
export type ContractStatus = 'active' | 'expiring_soon' | 'expired' | 'terminated' | 'pending_renewal';

// Salary component types (Phase 2 — allowances & deductions)
export type SalaryComponentType = 'allowance' | 'deduction';
export type SalaryCalculationType = 'fixed' | 'percentage';

export interface SalaryComponent {
  id: string;
  contractId: string;
  type: SalaryComponentType;
  name: string;
  calculationType: SalaryCalculationType;
  amount: number; // fixed amount or percentage of base salary
  currencyCode: string;
}

export interface EmployeeContract {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  outletId: string;
  outletName: string;
  contractType: ContractType;
  contractNumber: string;
  startDate: string;
  endDate: string | null; // null for indefinite
  baseSalary: number;
  status: ContractStatus;
  signedAt: string;
  renewalCount: number;
  notes?: string;
}
