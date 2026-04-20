import { Building2, ChevronDown } from 'lucide-react';
import type { ScopeOutlet } from '@/api/org-api';

interface Props {
  outletId: string | null;
  outlets: ScopeOutlet[];
  onChange: (id: string) => void;
}

export function OutletPicker({ outletId, outlets, onChange }: Props) {
  if (outlets.length <= 1) {
    const current = outlets[0];
    if (!current) return null;
    return (
      <div className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md border bg-white">
        <Building2 className="w-4 h-4 pos-accent-text" />
        <span className="font-medium truncate max-w-[160px]">{current.name}</span>
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        value={outletId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none inline-flex items-center gap-1.5 text-sm h-9 pl-8 pr-8 rounded-md border bg-white hover:bg-accent cursor-pointer min-w-[180px]"
      >
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>{o.name ?? o.code}</option>
        ))}
      </select>
      <Building2 className="w-4 h-4 pos-accent-text absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
