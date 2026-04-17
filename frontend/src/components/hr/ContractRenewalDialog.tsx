import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { hrApi, type AuthUserListItem, type ContractView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { getHrUserDisplay, formatHrEnumLabel } from '@/components/hr/hr-display';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function suggestEndDate(contract: ContractView, newStartDate: string): string {
  if (contract.startDate && contract.endDate) {
    const duration = daysBetween(contract.startDate, contract.endDate);
    if (duration > 0) return addDays(newStartDate, duration);
  }
  // Default: 12 months
  const d = new Date(newStartDate);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function formatCurrency(value: unknown, currency = 'USD') {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ContractRenewalDialogProps {
  contract: ContractView;
  token: string;
  usersById: Map<string, AuthUserListItem>;
  onClose: () => void;
  onRenewed: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContractRenewalDialog({
  contract,
  token,
  usersById,
  onClose,
  onRenewed,
}: ContractRenewalDialogProps) {
  const userDisplay = getHrUserDisplay(usersById, contract.userId);

  const defaultStart = contract.endDate
    ? addDays(contract.endDate, 1)
    : new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    employmentType: String(contract.employmentType || 'indefinite'),
    salaryType: String(contract.salaryType || 'monthly'),
    baseSalary: String(contract.baseSalary || ''),
    currencyCode: String(contract.currencyCode || 'USD'),
    regionCode: String(contract.regionCode || ''),
    startDate: defaultStart,
    endDate: suggestEndDate(contract, defaultStart),
    taxCode: String(contract.taxCode || ''),
    bankAccount: String(contract.bankAccount || ''),
    terminateOld: true,
  });
  const [busy, setBusy] = useState(false);

  const previousDuration = contract.startDate && contract.endDate
    ? daysBetween(contract.startDate, contract.endDate)
    : null;

  const submit = async () => {
    const base = parseFloat(form.baseSalary);
    if (!base || base <= 0) { toast.error('Base salary must be a positive number'); return; }
    if (!form.startDate) { toast.error('Start date is required'); return; }
    if (!form.currencyCode.trim() || form.currencyCode.trim().length !== 3) {
      toast.error('Enter a valid 3-letter currency code'); return;
    }
    setBusy(true);
    try {
      // Create new contract
      await hrApi.createContract(token, {
        userId: String(contract.userId),
        employmentType: form.employmentType,
        salaryType: form.salaryType,
        baseSalary: base,
        currencyCode: form.currencyCode.trim(),
        regionCode: form.regionCode.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        taxCode: form.taxCode.trim() || null,
        bankAccount: form.bankAccount.trim() || null,
      });

      // Optionally terminate the old contract
      if (form.terminateOld) {
        try {
          await hrApi.terminateContract(token, String(contract.id), {
            endDate: contract.endDate || form.startDate,
          });
        } catch {
          // Non-critical — old contract may already be expired
        }
      }

      toast.success('Contract renewed successfully');
      onRenewed();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to renew contract'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Renew Contract
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Create a new contract for <span className="font-medium">{userDisplay.primary}</span> based on the current one.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Previous contract summary */}
        <div className="mx-5 mt-4 p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Previous Contract</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Type</span>
              <p className="font-medium">{formatHrEnumLabel(contract.employmentType)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Salary</span>
              <p className="font-medium">{formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD'))}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Duration</span>
              <p className="font-medium">{previousDuration ? `${previousDuration} days` : 'Indefinite'}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Employment Type</label>
              <select
                value={form.employmentType}
                onChange={(e) => setForm((prev) => ({ ...prev, employmentType: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="indefinite">Indefinite</option>
                <option value="fixed_term">Fixed Term</option>
                <option value="probation">Probation</option>
                <option value="seasonal">Seasonal</option>
                <option value="part_time">Part Time</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Salary Type</label>
              <select
                value={form.salaryType}
                onChange={(e) => setForm((prev) => ({ ...prev, salaryType: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Base Salary <span className="text-destructive">*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.baseSalary}
                onChange={(e) => setForm((prev) => ({ ...prev, baseSalary: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Currency</label>
              <input
                type="text"
                maxLength={3}
                value={form.currencyCode}
                onChange={(e) => setForm((prev) => ({ ...prev, currencyCode: e.target.value.toUpperCase() }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Start Date <span className="text-destructive">*</span></label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  const newStart = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    startDate: newStart,
                    endDate: suggestEndDate(contract, newStart),
                  }));
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Auto-set to day after previous end date</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">End Date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              {previousDuration ? (
                <p className="text-[10px] text-muted-foreground">Suggested: same {previousDuration}-day duration</p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Tax Code</label>
              <input
                type="text"
                value={form.taxCode}
                onChange={(e) => setForm((prev) => ({ ...prev, taxCode: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Bank Account</label>
              <input
                type="text"
                value={form.bankAccount}
                onChange={(e) => setForm((prev) => ({ ...prev, bankAccount: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          {/* Terminate old option */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.terminateOld}
              onChange={(e) => setForm((prev) => ({ ...prev, terminateOld: e.target.checked }))}
              className="rounded border-input"
            />
            <span className="text-xs">Terminate the previous contract automatically</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-4 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60 flex items-center gap-1.5"
          >
            {busy ? 'Renewing...' : (
              <>
                <RefreshCw className="h-3.5 w-3.5" /> Renew Contract
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
