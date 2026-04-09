import type { AttendanceRecord, EmployeeContract } from '@/types/hr';

export const mockAttendanceRecords: AttendanceRecord[] = [
  {
    id: 'att-01', employeeId: 'emp-01', employeeName: 'Marcus Rivera', employeeRole: 'Outlet Manager',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '08:00–17:00', clockIn: '07:55', clockOut: '17:10',
    attendanceStatus: 'present', exception: 'none', approvalStatus: 'auto_approved',
  },
  {
    id: 'att-02', employeeId: 'emp-02', employeeName: 'Aisha Patel', employeeRole: 'Senior Cashier',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '09:00–18:00', clockIn: '09:22', clockOut: '18:00',
    attendanceStatus: 'late', exception: 'late_arrival', exceptionMinutes: 22, approvalStatus: 'pending_review',
    notes: 'Employee reported MRT delay — no supporting evidence submitted.',
  },
  {
    id: 'att-03', employeeId: 'emp-03', employeeName: 'Jason Lim', employeeRole: 'Barista',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '10:00–19:00', clockIn: '10:00',
    attendanceStatus: 'present', exception: 'missed_clock_out', approvalStatus: 'pending_review',
    notes: 'System shows no clock-out. Shift supervisor confirms employee left at ~19:05.',
  },
  {
    id: 'att-04', employeeId: 'emp-04', employeeName: 'Sarah Ng', employeeRole: 'Cashier',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '08:00–17:00',
    attendanceStatus: 'absent', exception: 'no_show', approvalStatus: 'flagged',
    notes: 'No call, no show. HR contacted — phone unreachable.',
  },
  {
    id: 'att-05', employeeId: 'emp-05', employeeName: 'David Chen', employeeRole: 'Line Cook',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '06:00–15:00', clockIn: '06:02', clockOut: '15:00',
    attendanceStatus: 'present', exception: 'none', approvalStatus: 'auto_approved',
  },
  {
    id: 'att-06', employeeId: 'emp-06', employeeName: 'Priya Sharma', employeeRole: 'Server',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '11:00–20:00', clockIn: '11:00', clockOut: '21:32',
    attendanceStatus: 'present', exception: 'overtime', exceptionMinutes: 92, approvalStatus: 'pending_review',
    notes: 'Dinner rush — requested by shift lead. 1h 32m overtime.',
  },
  {
    id: 'att-07', employeeId: 'emp-07', employeeName: 'Kevin Teo', employeeRole: 'Barista',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '08:00–17:00', clockIn: '08:00', clockOut: '13:00',
    attendanceStatus: 'half_day', exception: 'early_departure', exceptionMinutes: 240, approvalStatus: 'approved',
    reviewedBy: 'Marcus Rivera', reviewedAt: '2026-04-04T14:00:00',
    notes: 'Approved half-day — medical appointment.',
  },
  {
    id: 'att-08', employeeId: 'emp-08', employeeName: 'Lisa Wong', employeeRole: 'Server',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-04',
    scheduledShift: '09:00–18:00',
    attendanceStatus: 'leave', exception: 'none', approvalStatus: 'auto_approved',
    notes: 'Annual leave — approved in advance.',
  },
  {
    id: 'att-09', employeeId: 'emp-02', employeeName: 'Aisha Patel', employeeRole: 'Senior Cashier',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-03',
    scheduledShift: '09:00–18:00', clockIn: '08:58', clockOut: '18:05',
    attendanceStatus: 'present', exception: 'none', approvalStatus: 'auto_approved',
  },
  {
    id: 'att-10', employeeId: 'emp-04', employeeName: 'Sarah Ng', employeeRole: 'Cashier',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', date: '2026-04-03',
    scheduledShift: '08:00–17:00', clockIn: '08:45', clockOut: '17:00',
    attendanceStatus: 'late', exception: 'late_arrival', exceptionMinutes: 45, approvalStatus: 'flagged',
    notes: 'Second late arrival this week. Pattern flagged by system.',
  },
];

export const ATTENDANCE_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  present: { label: 'Present', class: 'bg-success/10 text-success' },
  late: { label: 'Late', class: 'bg-warning/10 text-warning' },
  absent: { label: 'Absent', class: 'bg-destructive/10 text-destructive' },
  leave: { label: 'Leave', class: 'bg-info/10 text-info' },
  half_day: { label: 'Half Day', class: 'bg-muted text-muted-foreground' },
};

export const EXCEPTION_CONFIG: Record<string, { label: string; class: string }> = {
  none: { label: '—', class: '' },
  late_arrival: { label: 'Late Arrival', class: 'bg-warning/10 text-warning' },
  early_departure: { label: 'Early Departure', class: 'bg-muted text-muted-foreground' },
  missed_clock_out: { label: 'Missed Clock-Out', class: 'bg-warning/10 text-warning' },
  overtime: { label: 'Overtime', class: 'bg-info/10 text-info' },
  no_show: { label: 'No Show', class: 'bg-destructive/10 text-destructive' },
};

export const APPROVAL_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  pending_review: { label: 'Pending Review', class: 'bg-warning/10 text-warning' },
  approved: { label: 'Approved', class: 'bg-success/10 text-success' },
  flagged: { label: 'Flagged', class: 'bg-destructive/10 text-destructive' },
  auto_approved: { label: 'Auto-Approved', class: 'bg-muted text-muted-foreground' },
};

export const mockContracts: EmployeeContract[] = [
  {
    id: 'ct-001', employeeId: 'emp-01', employeeName: 'Marcus Rivera', employeeRole: 'Outlet Manager',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    contractType: 'indefinite', contractNumber: 'HD-2024-001',
    startDate: '2024-01-15', endDate: null, baseSalary: 25000000,
    status: 'active', signedAt: '2024-01-10', renewalCount: 1,
  },
  {
    id: 'ct-002', employeeId: 'emp-02', employeeName: 'Linh Đặng', employeeRole: 'Senior Barista',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    contractType: 'fixed_term', contractNumber: 'HD-2025-012',
    startDate: '2025-06-01', endDate: '2026-05-31', baseSalary: 12000000,
    status: 'active', signedAt: '2025-05-28', renewalCount: 0,
  },
  {
    id: 'ct-003', employeeId: 'emp-03', employeeName: 'Nguyễn Văn An', employeeRole: 'Cashier',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    contractType: 'fixed_term', contractNumber: 'HD-2025-018',
    startDate: '2025-03-01', endDate: '2026-04-30', baseSalary: 9500000,
    status: 'expiring_soon', signedAt: '2025-02-25', renewalCount: 0,
    notes: 'Contract expiring in 25 days — schedule renewal meeting',
  },
  {
    id: 'ct-004', employeeId: 'emp-04', employeeName: 'Trần Thị Bình', employeeRole: 'Kitchen Staff',
    outletId: 'outlet-002', outletName: 'Riverside Branch',
    contractType: 'probation', contractNumber: 'HD-2026-003',
    startDate: '2026-03-01', endDate: '2026-05-01', baseSalary: 8000000,
    status: 'active', signedAt: '2026-02-28', renewalCount: 0,
    notes: 'Probation ends May 1 — performance review scheduled',
  },
  {
    id: 'ct-005', employeeId: 'emp-05', employeeName: 'Phạm Minh Đức', employeeRole: 'Waiter',
    outletId: 'outlet-002', outletName: 'Riverside Branch',
    contractType: 'fixed_term', contractNumber: 'HD-2024-045',
    startDate: '2024-10-01', endDate: '2026-03-31', baseSalary: 9000000,
    status: 'expired', signedAt: '2024-09-28', renewalCount: 1,
    notes: 'Expired — pending renewal decision',
  },
  {
    id: 'ct-006', employeeId: 'emp-06', employeeName: 'Đỗ Quang Huy', employeeRole: 'Shift Lead',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    contractType: 'indefinite', contractNumber: 'HD-2023-008',
    startDate: '2023-07-01', endDate: null, baseSalary: 15000000,
    status: 'active', signedAt: '2023-06-28', renewalCount: 2,
  },
  {
    id: 'ct-007', employeeId: 'emp-07', employeeName: 'Hoàng Thị Lan', employeeRole: 'Barista',
    outletId: 'outlet-003', outletName: 'Mall Kiosk A',
    contractType: 'seasonal', contractNumber: 'HD-2026-S01',
    startDate: '2026-03-15', endDate: '2026-09-15', baseSalary: 8500000,
    status: 'active', signedAt: '2026-03-12', renewalCount: 0,
    notes: 'Summer seasonal hire',
  },
  {
    id: 'ct-008', employeeId: 'emp-08', employeeName: 'Bùi Thanh Tùng', employeeRole: 'Delivery Runner',
    outletId: 'outlet-004', outletName: 'Uptown Express',
    contractType: 'part_time', contractNumber: 'HD-2026-PT02',
    startDate: '2026-02-01', endDate: '2026-07-31', baseSalary: 5000000,
    status: 'active', signedAt: '2026-01-30', renewalCount: 0,
  },
  {
    id: 'ct-009', employeeId: 'emp-09', employeeName: 'Lê Minh Tuấn', employeeRole: 'Head Chef',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    contractType: 'fixed_term', contractNumber: 'HD-2025-022',
    startDate: '2025-01-01', endDate: '2026-04-15', baseSalary: 18000000,
    status: 'expiring_soon', signedAt: '2024-12-28', renewalCount: 0,
    notes: 'Key employee — prioritize renewal',
  },
  {
    id: 'ct-010', employeeId: 'emp-10', employeeName: 'Võ Thị Mai', employeeRole: 'Cashier',
    outletId: 'outlet-004', outletName: 'Uptown Express',
    contractType: 'fixed_term', contractNumber: 'HD-2024-033',
    startDate: '2024-06-01', endDate: '2026-02-28', baseSalary: 9000000,
    status: 'terminated', signedAt: '2024-05-28', renewalCount: 0,
    notes: 'Terminated — disciplinary reasons',
  },
];

export const CONTRACT_TYPE_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  probation: { label: 'Thử việc', variant: 'outline' },
  fixed_term: { label: 'Có thời hạn', variant: 'secondary' },
  indefinite: { label: 'Không thời hạn', variant: 'default' },
  seasonal: { label: 'Thời vụ', variant: 'outline' },
  part_time: { label: 'Bán thời gian', variant: 'outline' },
};

export const CONTRACT_STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Đang hiệu lực', variant: 'default' },
  expiring_soon: { label: 'Sắp hết hạn', variant: 'outline' },
  expired: { label: 'Đã hết hạn', variant: 'destructive' },
  terminated: { label: 'Đã chấm dứt', variant: 'destructive' },
  pending_renewal: { label: 'Chờ gia hạn', variant: 'secondary' },
};
