import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { hrApi, type AuthUserListItem, type ContractView } from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';

export interface ContractEditDialogProps {
  contract: ContractView;
  token: string;
  users: AuthUserListItem[];
  onClose: () => void;
  onSaved: () => void;
}

export function ContractEditDialog({
  contract,
  token,
  users,
  onClose,
  onSaved,
}: ContractEditDialogProps) {
  const [form, setForm] = useState({
    employmentType: String(contract.employmentType || 'indefinite'),
    salaryType: String(contract.salaryType || 'monthly'),
    baseSalary: String(contract.baseSalary || ''),
    currencyCode: String(contract.currencyCode || 'USD'),
    regionCode: String(contract.regionCode || ''),
    startDate: String(contract.startDate || ''),
    endDate: String(contract.endDate || ''),
    taxCode: String(contract.taxCode || ''),
    bankAccount: String(contract.bankAccount || ''),
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const base = parseFloat(form.baseSalary);
    if (!base || base <= 0) { toast.error('Base salary must be a positive number'); return; }
    if (!form.currencyCode.trim() || form.currencyCode.trim().length !== 3) {
      toast.error('Enter a valid 3-letter currency code'); return;
    }
    setBusy(true);
    try {
      await hrApi.updateContract(token, String(contract.id), {
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
      toast.success('Contract updated');
      onSaved();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to update contract'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Edit Contract</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Update the employment contract terms.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
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
                placeholder="e.g. 5000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Currency <span className="text-destructive">*</span></label>
              <input
                type="text"
                maxLength={3}
                value={form.currencyCode}
                onChange={(e) => setForm((prev) => ({ ...prev, currencyCode: e.target.value.toUpperCase() }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                placeholder="USD"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">End Date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Region Code</label>
              <input
                type="text"
                value={form.regionCode}
                onChange={(e) => setForm((prev) => ({ ...prev, regionCode: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="e.g. VN"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Tax Code</label>
              <input
                type="text"
                value={form.taxCode}
                onChange={(e) => setForm((prev) => ({ ...prev, taxCode: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Employee tax ID"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Bank Account</label>
            <input
              type="text"
              value={form.bankAccount}
              onChange={(e) => setForm((prev) => ({ ...prev, bankAccount: e.target.value }))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Account number for salary payment"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-4 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
