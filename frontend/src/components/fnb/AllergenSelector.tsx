import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { AllergenView, ProductAllergenInput, ProductAllergenView } from '@/api/fnb-api';
import { fnbApi } from '@/api/fnb-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';

interface Props {
  value: ProductAllergenView[];
  onChange: (next: ProductAllergenInput[]) => void;
  disabled?: boolean;
}

export function AllergenSelector({ value, onChange, disabled }: Props) {
  const { token } = useShellRuntime();
  const [allergens, setAllergens] = useState<AllergenView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    fnbApi
      .listAllergens(token)
      .then((rows) => {
        if (active) setAllergens(rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const selectedMap = useMemo(() => {
    const m = new Map<string, ProductAllergenView>();
    for (const v of value) m.set(v.code, v);
    return m;
  }, [value]);

  const toggle = (allergen: AllergenView, isTraces: boolean) => {
    const exists = selectedMap.get(allergen.code);
    if (exists && exists.isTraces === isTraces) {
      const next: ProductAllergenInput[] = value
        .filter((v) => v.code !== allergen.code)
        .map((v) => ({ code: v.code, isTraces: v.isTraces }));
      onChange(next);
    } else {
      const next: ProductAllergenInput[] = value
        .filter((v) => v.code !== allergen.code)
        .map((v) => ({ code: v.code, isTraces: v.isTraces }));
      next.push({ code: allergen.code, isTraces });
      onChange(next);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải allergen...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {allergens.map((a) => {
        const sel = selectedMap.get(a.code);
        const fullySelected = sel && !sel.isTraces;
        const tracesSelected = sel && sel.isTraces;
        return (
          <div key={a.code} className="flex items-center gap-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(a, false)}
              className={`flex-1 px-2 py-1.5 rounded-md border text-left text-xs flex items-center gap-1 transition-colors ${
                fullySelected
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border hover:bg-muted'
              }`}
              title={a.labelEn}
            >
              {a.icon ? <span aria-hidden="true">{a.icon}</span> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
              <span className="flex-1 truncate">{a.label}</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggle(a, true)}
              title="Có vết / có thể có"
              className={`px-1.5 py-1.5 rounded-md border text-[10px] font-mono ${
                tracesSelected
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border hover:bg-muted text-muted-foreground'
              }`}
            >
              ~
            </button>
          </div>
        );
      })}
    </div>
  );
}
