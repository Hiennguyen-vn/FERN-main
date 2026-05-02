import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, Save, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fnbApi, type AllergenView, type CustomerAllergyView, type CustomerAllergyInput } from '@/api/fnb-api';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { reportError } from '@/lib/report-error';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

const SEVERITY_TONE: Record<CustomerAllergyView['severity'], string> = {
  NOTE: 'bg-warning/10 border-warning/30 text-warning',
  AVOID: 'bg-warning/20 border-warning/50 text-warning',
  SEVERE: 'bg-destructive/15 border-destructive/50 text-destructive ring-1 ring-destructive',
};

const SEVERITY_PREFIX: Record<CustomerAllergyView['severity'], string> = {
  NOTE: '',
  AVOID: '',
  SEVERE: '! ',
};

export function CustomerAllergyEditor({ open, onOpenChange, customerId, customerName }: Props) {
  const { token } = useShellRuntime();
  const [allergens, setAllergens] = useState<AllergenView[]>([]);
  const [picked, setPicked] = useState<Map<string, CustomerAllergyInput>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setLoading(true);
    Promise.all([
      fnbApi.listAllergens(token),
      fnbApi.getCustomerAllergies(token, customerId),
    ])
      .then(([all, current]) => {
        if (!active) return;
        setAllergens(all);
        const m = new Map<string, CustomerAllergyInput>();
        current.forEach((c) => m.set(c.code, { code: c.code, severity: c.severity, note: c.note ?? null }));
        setPicked(m);
      })
      .catch((e) => reportError(e, 'crm.customer-allergies.load'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, token, customerId]);

  const setSeverity = (code: string, severity: CustomerAllergyView['severity'] | null) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (severity === null) {
        next.delete(code);
      } else {
        const cur = next.get(code);
        next.set(code, { code, severity, note: cur?.note ?? null });
      }
      return next;
    });
  };

  const setNote = (code: string, note: string) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const cur = next.get(code);
      if (!cur) return prev;
      next.set(code, { ...cur, note: note.trim() || null });
      return next;
    });
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await fnbApi.setCustomerAllergies(token, customerId, Array.from(picked.values()));
      toast.success(`Đã lưu ${picked.size} dị ứng cho ${customerName}`);
      onOpenChange(false);
    } catch (e) {
      const msg = reportError(e, 'crm.customer-allergies.save', 'Lưu dị ứng thất bại');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" /> Dị ứng của {customerName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <p className="text-[11px] text-muted-foreground">
              Chọn mức độ cho từng allergen. Note tùy chọn.
            </p>
            <div className="space-y-2">
              {allergens.map((a) => {
                const cur = picked.get(a.code);
                return (
                  <div
                    key={a.code}
                    className={cn(
                      'p-2 rounded-md border space-y-1.5',
                      cur ? SEVERITY_TONE[cur.severity] : 'border-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span aria-hidden="true">{a.icon ?? '⚠'}</span>
                        <span className="truncate">{a.label}</span>
                      </span>
                      <div role="radiogroup" aria-label={`Severity for ${a.label}`} className="flex rounded-md border overflow-hidden text-[10px]">
                        {(['', 'NOTE', 'AVOID', 'SEVERE'] as const).map((sev) => {
                          const active = sev === '' ? !cur : cur?.severity === sev;
                          const label = sev === '' ? 'Off' : sev;
                          return (
                            <button
                              key={sev || 'off'}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setSeverity(a.code, sev === '' ? null : sev as CustomerAllergyView['severity'])}
                              className={cn(
                                'px-2 py-1 font-mono text-[11px] transition-colors min-h-[28px]',
                                active
                                  ? 'bg-foreground text-background font-bold'
                                  : 'hover:bg-muted text-muted-foreground',
                              )}
                            >
                              {sev === 'SEVERE' ? `${SEVERITY_PREFIX.SEVERE}${label}` : label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {cur && (
                      <Input
                        placeholder="Note (tùy chọn)"
                        value={cur.note ?? ''}
                        onChange={(e) => setNote(a.code, e.target.value)}
                        className="h-7 text-xs"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t pt-3 mt-3 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs gap-1">
            <X className="h-3 w-3" /> Đóng
          </Button>
          <Button size="sm" disabled={saving || loading} onClick={() => void save()} className="h-8 text-xs gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Lưu ({picked.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
