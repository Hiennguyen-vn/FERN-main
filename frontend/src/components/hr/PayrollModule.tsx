import { useState } from 'react';
import {
  DollarSign, Users, FileText, ChevronRight, Download,
  CheckCircle, Clock, AlertTriangle, Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';

interface Payslip {
  id: string;
  employeeName: string;
  employeeId: string;
  department: string;
  period: string;
  basicSalary: number;
  allowances: number;
  overtime: number;
  grossPay: number;
  tax: number;
  deductions: number;
  netPay: number;
  status: 'draft' | 'approved' | 'paid';
}

const MOCK_PAYSLIPS: Payslip[] = [
  { id: 'PS-001', employeeName: 'Aisha Patel', employeeId: 'EMP-001', department: 'Operations', period: 'Mar 2026', basicSalary: 4200, allowances: 500, overtime: 320, grossPay: 5020, tax: 502, deductions: 180, netPay: 4338, status: 'paid' },
  { id: 'PS-002', employeeName: 'Marcus Rivera', employeeId: 'EMP-002', department: 'Management', period: 'Mar 2026', basicSalary: 6500, allowances: 800, overtime: 0, grossPay: 7300, tax: 1095, deductions: 250, netPay: 5955, status: 'approved' },
  { id: 'PS-003', employeeName: 'Sarah Chen', employeeId: 'EMP-003', department: 'Administration', period: 'Mar 2026', basicSalary: 7800, allowances: 1000, overtime: 0, grossPay: 8800, tax: 1540, deductions: 300, netPay: 6960, status: 'approved' },
  { id: 'PS-004', employeeName: 'James Park', employeeId: 'EMP-004', department: 'Operations', period: 'Mar 2026', basicSalary: 3800, allowances: 400, overtime: 480, grossPay: 4680, tax: 468, deductions: 150, netPay: 4062, status: 'draft' },
  { id: 'PS-005', employeeName: 'Linda Wu', employeeId: 'EMP-005', department: 'Operations', period: 'Mar 2026', basicSalary: 3800, allowances: 400, overtime: 160, grossPay: 4360, tax: 436, deductions: 150, netPay: 3774, status: 'draft' },
  { id: 'PS-006', employeeName: 'David Kim', employeeId: 'EMP-006', department: 'Kitchen', period: 'Mar 2026', basicSalary: 4000, allowances: 350, overtime: 240, grossPay: 4590, tax: 459, deductions: 160, netPay: 3971, status: 'paid' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  approved: 'bg-primary/10 text-primary',
  paid: 'bg-success/10 text-success',
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

export function PayrollModule() {
  const [selected, setSelected] = useState<Payslip | null>(null);

  const totalGross = MOCK_PAYSLIPS.reduce((s, p) => s + p.grossPay, 0);
  const totalNet = MOCK_PAYSLIPS.reduce((s, p) => s + p.netPay, 0);
  const totalTax = MOCK_PAYSLIPS.reduce((s, p) => s + p.tax, 0);
  const draftCount = MOCK_PAYSLIPS.filter(p => p.status === 'draft').length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Payroll & Payslips</h2>
          <p className="text-xs text-muted-foreground mt-0.5">March 2026 payroll cycle — {MOCK_PAYSLIPS.length} employees</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><Calculator className="h-3 w-3" /> Calculate All</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5"><Download className="h-3 w-3" /> Export</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Gross', value: fmt(totalGross), icon: DollarSign, sub: `${MOCK_PAYSLIPS.length} employees` },
          { label: 'Total Net Pay', value: fmt(totalNet), icon: DollarSign, sub: 'After deductions' },
          { label: 'Total Tax', value: fmt(totalTax), icon: AlertTriangle, sub: 'Withholding + GST' },
          { label: 'Pending Draft', value: draftCount.toString(), icon: Clock, sub: 'Awaiting approval' },
        ].map(k => (
          <div key={k.label} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{k.label}</span>
            </div>
            <p className="text-xl font-semibold text-foreground">{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Payslip table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Employee', 'Dept', 'Basic', 'Allowances', 'OT', 'Gross', 'Tax', 'Deductions', 'Net Pay', 'Status', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-3 py-2.5',
                  !['Employee', 'Dept', 'Status', ''].includes(h) ? 'text-right' : 'text-left'
                )}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_PAYSLIPS.map(p => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => setSelected(p)}>
                <td className="px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{p.employeeName}</p>
                  <p className="text-[10px] text-muted-foreground">{p.employeeId}</p>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.department}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm">{fmt(p.basicSalary)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm">{fmt(p.allowances)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm">{p.overtime > 0 ? fmt(p.overtime) : '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm font-medium">{fmt(p.grossPay)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm text-destructive">{fmt(p.tax)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm text-destructive">{fmt(p.deductions)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-sm font-semibold">{fmt(p.netPay)}</td>
                <td className="px-3 py-2.5">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', STATUS_STYLES[p.status])}>{p.status}</span>
                </td>
                <td className="px-3 py-2.5"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-lg">{selected.employeeName}</SheetTitle>
                <SheetDescription>{selected.employeeId} · {selected.department} · {selected.period}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Salary breakdown */}
                <div className="surface-elevated p-4 space-y-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Earnings</span>
                  {[
                    { label: 'Basic Salary', value: selected.basicSalary },
                    { label: 'Allowances', value: selected.allowances },
                    { label: 'Overtime', value: selected.overtime },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <span className="text-sm font-mono">{fmt(item.value)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between">
                    <span className="text-sm font-medium">Gross Pay</span>
                    <span className="text-sm font-mono font-semibold">{fmt(selected.grossPay)}</span>
                  </div>
                </div>

                <div className="surface-elevated p-4 space-y-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Deductions</span>
                  {[
                    { label: 'Income Tax', value: selected.tax },
                    { label: 'Other Deductions', value: selected.deductions },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between py-1.5">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <span className="text-sm font-mono text-destructive">-{fmt(item.value)}</span>
                    </div>
                  ))}
                </div>

                <div className="surface-elevated p-5 border-l-4 border-l-primary">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-foreground">Net Pay</span>
                    <span className="text-2xl font-bold text-foreground">{fmt(selected.netPay)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {selected.status === 'draft' && (
                    <Button size="sm" className="flex-1 h-9 text-xs gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Approve Payslip</Button>
                  )}
                  {selected.status === 'approved' && (
                    <Button size="sm" className="flex-1 h-9 text-xs gap-1.5"><DollarSign className="h-3.5 w-3.5" /> Mark as Paid</Button>
                  )}
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5"><Download className="h-3.5 w-3.5" /> Download PDF</Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
