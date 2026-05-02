import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { fnbApi, type ModifierGroupView, type ModifierOptionView } from '@/api/fnb-api';
import { cn } from '@/lib/utils';

export interface SelectedModifier {
  groupId: number;
  groupCode: string;
  optionId: number;
  optionCode: string;
  label: string;
  priceDelta: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | number;
  productName: string;
  basePrice: number;
  onConfirm: (selected: SelectedModifier[], priceDeltaTotal: number) => void;
}

export function ModifierPicker({ open, onOpenChange, productId, productName, basePrice, onConfirm }: Props) {
  const { token } = useShellRuntime();
  const [groups, setGroups] = useState<ModifierGroupView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Record<number, Set<number>>>({});
  const [attemptedConfirm, setAttemptedConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset stale state when dialog closes so reopening for a different product starts clean.
      setGroups([]);
      setSelection({});
      setAttemptedConfirm(false);
      return;
    }
    if (!token) return;
    let active = true;
    setGroups([]);
    setSelection({});
    setLoading(true);
    fnbApi
      .getProductModifierGroups(token, productId)
      .then((rows) => {
        if (!active) return;
        setGroups(rows);
        const init: Record<number, Set<number>> = {};
        for (const g of rows) {
          const set = new Set<number>();
          for (const o of g.options) if (o.isDefault) set.add(o.id);
          init[g.id] = set;
        }
        setSelection(init);
      })
      .catch(() => {
        if (active) setGroups([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, token, productId]);

  const toggleOption = (group: ModifierGroupView, option: ModifierOptionView) => {
    setSelection((prev) => {
      const next = { ...prev };
      const cur = new Set(next[group.id] ?? []);
      if (group.selectionType === 'SINGLE' || group.maxSelect <= 1) {
        if (cur.has(option.id)) cur.clear();
        else {
          cur.clear();
          cur.add(option.id);
        }
      } else {
        if (cur.has(option.id)) cur.delete(option.id);
        else if (cur.size < group.maxSelect) cur.add(option.id);
      }
      next[group.id] = cur;
      return next;
    });
  };

  const violationGroupIds = useMemo(() => {
    const ids = new Set<number>();
    for (const g of groups) {
      const count = selection[g.id]?.size ?? 0;
      if (count < g.minSelect) ids.add(g.id);
    }
    return ids;
  }, [groups, selection]);

  const violations = useMemo(
    () => groups
      .filter((g) => violationGroupIds.has(g.id))
      .map((g) => `${g.name}: chọn tối thiểu ${g.minSelect}`),
    [groups, violationGroupIds],
  );

  const priceDelta = useMemo(() => {
    let total = 0;
    for (const g of groups) {
      const ids = selection[g.id] ?? new Set();
      for (const o of g.options) if (ids.has(o.id)) total += Number(o.priceDelta) || 0;
    }
    return total;
  }, [groups, selection]);

  const handleConfirm = () => {
    if (violations.length > 0) {
      setAttemptedConfirm(true);
      // Scroll to first invalid group.
      const firstId = Array.from(violationGroupIds)[0];
      if (firstId !== undefined) {
        document.getElementById(`mod-group-${firstId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    setAttemptedConfirm(false);
    const out: SelectedModifier[] = [];
    for (const g of groups) {
      const ids = selection[g.id] ?? new Set();
      for (const o of g.options) {
        if (ids.has(o.id)) {
          out.push({
            groupId: g.id,
            groupCode: g.code,
            optionId: o.id,
            optionCode: o.code,
            label: `${g.name}: ${o.label}`,
            priceDelta: Number(o.priceDelta) || 0,
          });
        }
      }
    }
    onConfirm(out, priceDelta);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{productName}</DialogTitle>
          <p className="text-xs text-muted-foreground">Tùy chỉnh trước khi gửi bếp</p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải tùy chọn...
          </div>
        ) : groups.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Món này không có tùy chọn.
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {groups.map((g) => {
              const cur = selection[g.id] ?? new Set<number>();
              const isMulti = g.selectionType === 'MULTI' && g.maxSelect > 1;
              const invalid = violationGroupIds.has(g.id) && attemptedConfirm;
              return (
                <div
                  key={g.id}
                  id={`mod-group-${g.id}`}
                  aria-invalid={invalid}
                  className={cn(
                    'space-y-1.5 rounded-md p-1.5 transition-colors',
                    invalid && 'bg-destructive/5 ring-1 ring-destructive/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-sm font-medium', invalid ? 'text-destructive' : 'text-foreground')}>
                      {g.name}
                      {g.required && <span className="text-destructive ml-0.5">*</span>}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {isMulti ? `Chọn ${g.minSelect}-${g.maxSelect}` : 'Chọn 1'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.options.map((o) => {
                      const active = cur.has(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleOption(g, o)}
                          className={`px-2.5 py-2 rounded-md border text-left text-xs transition-colors ${
                            active
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border hover:bg-muted'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate">{o.label}</span>
                            {o.priceDelta != null && Number(o.priceDelta) !== 0 && (
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                {Number(o.priceDelta) > 0 ? '+' : ''}
                                {Number(o.priceDelta).toLocaleString('vi-VN')}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {violations.length > 0 && (
          <ul className="text-[11px] text-destructive list-disc pl-4 mt-2">
            {violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-3 mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Giá gốc</span>
            <span className="tabular-nums">{basePrice.toLocaleString('vi-VN')}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Phụ thu</span>
            <span className="tabular-nums">
              {priceDelta > 0 ? '+' : ''}
              {priceDelta.toLocaleString('vi-VN')}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Tổng / phần</span>
            <span className="tabular-nums">
              {(basePrice + priceDelta).toLocaleString('vi-VN')}
            </span>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button
              className="flex-1"
              disabled={loading}
              onClick={handleConfirm}
            >
              <Plus className="h-3 w-3 mr-1" /> Thêm vào order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
