// Finance & payroll types — aligned to backend truth

export type PayrollPeriodStatus = 'open' | 'closed' | 'locked';

export interface PayrollPeriod {
  id: string;
  regionId: string;
  regionName: string;
  startDate: string;
  endDate: string;
  status: PayrollPeriodStatus;
  runCount: number;
}

export type PayrollRunStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'paid';

export interface PayrollRun {
  id: string;
  periodId: string;
  regionName: string;
  periodLabel: string;
  employeeCount: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  status: PayrollRunStatus;
  preparedBy: string;
  approvedBy: string | null;
  createdAt: string;
}

export interface PayrollEmployee {
  id: string;
  name: string;
  outlet: string;
  role: string;
  hoursWorked: number;
  basePay: number;
  overtime: number;
  deductions: number;
  netPay: number;
}

export interface PayrollAuditEntry {
  action: string;
  actor: string;
  timestamp: string;
  detail: string;
}

export interface FinanceConfigSection {
  id: string;
  label: string;
  description: string;
  settings: FinanceConfigSetting[];
}

export interface FinanceConfigSetting {
  key: string;
  label: string;
  value: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: string[];
}

export type ExportJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ExportJob {
  id: string;
  module: string;
  label: string;
  requester: string;
  scope: string;
  requestedAt: string;
  completedAt: string | null;
  status: ExportJobStatus;
  fileSize: string | null;
}
