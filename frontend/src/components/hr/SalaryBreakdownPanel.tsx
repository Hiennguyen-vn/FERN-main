import { useState } from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContractView } from '@/api/fern-api';
import type { SalaryComponent, SalaryComponentType, SalaryCalculationType } from '@/types/hr';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `local-${idCounter}`;
}

// Common F&B salary components
const PRESETS: Array<{ name: string; type: SalaryComponentType; calcType: SalaryCalculationType; defaultAmount: number }> = [
  { name: 'Housing Allowance', type: 'allowance', calcType: 'fixed', defaultAmount: 500 },
  { name: 'Transport Allowance', type: 'allowance', calcType: 'fixed', defaultAmount: 200 },
  { name: 'Meal Allowance', type: 'allowance', calcType: 'fixed', defaultAmount: 150 },
  { name: 'Service Charge', type: 'allowance', calcType: 'percentage', defaultAmount: 10 },
  { name: 'Social Insurance', type: 'deduction', calcType: 'percentage', defaultAmount: 8 },
  { name: 'Health Insurance', type: 'deduction', calcType: 'percentage', defaultAmount: 1.5 },
  { name: 'Income Tax', type: 'deduction', calcType: 'percentage', defaultAmount: 10 },
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface SalaryBreakdownPanelProps {
  contract: ContractView;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SalaryBreakdownPanel({ contract }: SalaryBreakdownPanelProps) {
  const baseSalary = toNumber(contract.baseSalary);
  const currency = String(contract.currencyCode || 'USD');
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newComp, setNewComp] = useState({
    name: '',
    type: 'allowance' as SalaryComponentType,
    calculationType: 'fixed' as SalaryCalculationType,
    amount: '',
  });

  const addComponent = () => {
    const amount = parseFloat(newComp.amount);
    if (!newComp.name.trim() || !amount || amount <= 0) return;
    setComponents((prev) => [
      ...prev,
      {
        id: nextId(),
        contractId: String(contract.id),
        type: newComp.type,
        name: newComp.name.trim(),
        calculationType: newComp.calculationType,
        amount,
        currencyCode: currency,
      },
    ]);
    setNewComp({ name: '', type: 'allowance', calculationType: 'fixed', amount: '' });
    setShowAddForm(false);
  };

  const addPreset = (preset: typeof PRESETS[number]) => {
    setComponents((prev) => [
      ...prev,
      {
        id: nextId(),
        contractId: String(contract.id),
        type: preset.type,
        name: preset.name,
        calculationType: preset.calcType,
        amount: preset.defaultAmount,
        currencyCode: currency,
      },
    ]);
  };

  const removeComponent = (id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id));
  };

  // Calculate totals
  const allowances = components.filter((c) => c.type === 'allowance');
  const deductions = components.filter((c) => c.type === 'deduction');

  const calcAmount = (comp: SalaryComponent) =>
    comp.calculationType === 'percentage' ? baseSalary * (comp.amount / 100) : comp.amount;

  const totalAllowances = allowances.reduce((sum, c) => sum + calcAmount(c), 0);
  const totalDeductions = deductions.reduce((sum, c) => sum + calcAmount(c), 0);
  const gross = baseSalary + totalAllowances;
  const net = gross - totalDeductions;

  // Available presets (exclude already added)
  const addedNames = new Set(components.map((c) => c.name));
  const availablePresets = PRESETS.filter((p) => !addedNames.has(p.name));

  return (
    <div className="surface-elevated p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Salary Breakdown</span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          <Plus className="h-3 w-3" /> Add component
        </button>
      </div>

      {/* Base salary */}
      <div className="flex justify-between py-1.5 border-b">
        <span className="text-sm font-medium">Base Salary</span>
        <span className="text-sm font-mono font-semibold">{formatCurrency(baseSalary, currency)}</span>
      </div>

      {/* Allowances */}
      {allowances.length > 0 ? (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-emerald-600 font-medium">Allowances</span>
          {allowances.map((comp) => (
            <div key={comp.id} className="flex items-center justify-between py-1 group">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => removeComponent(comp.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <span className="text-sm text-muted-foreground">{comp.name}</span>
                {comp.calculationType === 'percentage' ? (
                  <span className="text-[10px] text-muted-foreground/70">({comp.amount}%)</span>
                ) : null}
              </div>
              <span className="text-sm font-mono text-emerald-600">+{formatCurrency(calcAmount(comp), currency)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Deductions */}
      {deductions.length > 0 ? (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-destructive font-medium">Deductions</span>
          {deductions.map((comp) => (
            <div key={comp.id} className="flex items-center justify-between py-1 group">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => removeComponent(comp.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <span className="text-sm text-muted-foreground">{comp.name}</span>
                {comp.calculationType === 'percentage' ? (
                  <span className="text-[10px] text-muted-foreground/70">({comp.amount}%)</span>
                ) : null}
              </div>
              <span className="text-sm font-mono text-destructive">-{formatCurrency(calcAmount(comp), currency)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Totals */}
      <div className="border-t pt-2 space-y-1.5">
        <div className="flex justify-between py-0.5">
          <span className="text-sm text-muted-foreground">Gross Pay</span>
          <span className="text-sm font-mono font-medium">{formatCurrency(gross, currency)}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-sm text-muted-foreground">Total Deductions</span>
          <span className="text-sm font-mono text-destructive">-{formatCurrency(totalDeductions, currency)}</span>
        </div>
        <div className="flex justify-between py-1 border-t">
          <span className="text-sm font-semibold">Estimated Net Pay</span>
          <span className="text-sm font-mono font-bold">{formatCurrency(net, currency)}</span>
        </div>
      </div>

      {/* Quick add presets */}
      {availablePresets.length > 0 ? (
        <div className="pt-1">
          <p className="text-[10px] text-muted-foreground mb-1.5">Quick add:</p>
          <div className="flex flex-wrap gap-1">
            {availablePresets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => addPreset(preset)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border hover:bg-accent transition-colors',
                  preset.type === 'allowance' ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700',
                )}
              >
                + {preset.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Add custom form */}
      {showAddForm ? (
        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newComp.name}
              onChange={(e) => setNewComp((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Component name"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            />
            <select
              value={newComp.type}
              onChange={(e) => setNewComp((prev) => ({ ...prev, type: e.target.value as SalaryComponentType }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="allowance">Allowance</option>
              <option value="deduction">Deduction</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newComp.calculationType}
              onChange={(e) => setNewComp((prev) => ({ ...prev, calculationType: e.target.value as SalaryCalculationType }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="fixed">Fixed amount</option>
              <option value="percentage">% of base</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={newComp.amount}
              onChange={(e) => setNewComp((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder={newComp.calculationType === 'percentage' ? 'e.g. 10' : 'e.g. 500'}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => setShowAddForm(false)}
              className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={addComponent}
              className="h-7 px-2.5 rounded bg-primary text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
