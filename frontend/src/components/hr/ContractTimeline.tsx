import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { ContractView } from '@/api/fern-api';
import { contractBadgeClass, formatHrEnumLabel, shortHrRef } from '@/components/hr/hr-display';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function barColor(status: string) {
  switch (status) {
    case 'active': return 'bg-emerald-400';
    case 'draft': return 'bg-blue-400';
    case 'expired': return 'bg-amber-400';
    case 'terminated': return 'bg-rose-400';
    default: return 'bg-muted-foreground/40';
  }
}

function barTextColor(status: string) {
  switch (status) {
    case 'active': return 'text-emerald-700';
    case 'draft': return 'text-blue-700';
    case 'expired': return 'text-amber-700';
    case 'terminated': return 'text-rose-700';
    default: return 'text-muted-foreground';
  }
}

export interface ContractTimelineProps {
  contracts: ContractView[];
  onSelect?: (contract: ContractView) => void;
}

export function ContractTimeline({ contracts, onSelect }: ContractTimelineProps) {
  const sorted = useMemo(
    () => [...contracts].sort((a, b) => new Date(a.startDate || 0).getTime() - new Date(b.startDate || 0).getTime()),
    [contracts],
  );

  if (sorted.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No contracts to display</p>;
  }

  // Simple list-based timeline — each contract is a horizontal bar with label outside
  return (
    <div className="space-y-1.5">
      {sorted.map((contract) => {
        const status = String(contract.status || 'unknown').toLowerCase();
        const start = toDate(contract.startDate);
        const end = toDate(contract.endDate);
        const startLabel = start ? formatShortDate(contract.startDate) : '—';
        const endLabel = end ? formatShortDate(contract.endDate) : 'Ongoing';

        // Calculate duration for bar width (relative to longest contract)
        const durationDays = start && end
          ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000))
          : 365; // default 1 year for ongoing

        return (
          <div
            key={String(contract.id)}
            className={cn('group rounded-md p-2 hover:bg-muted/30 transition-colors', onSelect ? 'cursor-pointer' : '')}
            onClick={() => onSelect?.(contract)}
          >
            {/* Top row: ID + status + dates */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
                  {formatHrEnumLabel(status)}
                </span>
                <span className="text-[10px] font-medium text-foreground">{formatHrEnumLabel(contract.employmentType)}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{startLabel} — {endLabel}</span>
            </div>
            {/* Bar */}
            <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', barColor(status))}
                style={{ width: `${Math.min(100, Math.max(8, (durationDays / 365) * 100))}%` }}
              />
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-3 pt-1">
        {['active', 'draft', 'expired', 'terminated'].map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div className={cn('h-2 w-2 rounded-full', barColor(s))} />
            <span className="text-[10px] text-muted-foreground">{formatHrEnumLabel(s)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
