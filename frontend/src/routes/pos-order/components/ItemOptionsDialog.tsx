import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Minus, Plus } from 'lucide-react';
import type { ModifierGroupView } from '@/api/product-api';
import type { PosMenuItem } from '../hooks/use-pos-menu';
import type { CartLine } from '../hooks/use-pos-cart';
import { formatVnd } from '../utils/format';

interface Props {
  item: PosMenuItem | null;
  modifierGroups: ModifierGroupView[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (line: Omit<CartLine, 'lineId'>) => void;
}

type Selections = Record<string, string[]>;

export function ItemOptionsDialog({ item, modifierGroups, open, onOpenChange, onConfirm }: Props) {
  const [selections, setSelections] = useState<Selections>({});
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (open) {
      const initial: Selections = {};
      for (const g of modifierGroups) {
        if ((g.selectionType ?? 'single') === 'single' && (g.minSelections ?? 0) > 0 && g.options.length > 0) {
          initial[g.id] = [g.options[0].id];
        } else {
          initial[g.id] = [];
        }
      }
      setSelections(initial);
      setNote('');
      setQty(1);
    }
  }, [open, item?.id, modifierGroups]);

  const selectedOptions = useMemo(() => {
    if (!item) return [] as { group: ModifierGroupView; option: ModifierGroupView['options'][number] }[];
    const flat: { group: ModifierGroupView; option: ModifierGroupView['options'][number] }[] = [];
    for (const g of modifierGroups) {
      const chosenIds = selections[g.id] ?? [];
      for (const oid of chosenIds) {
        const opt = g.options.find((o) => o.id === oid);
        if (opt) flat.push({ group: g, option: opt });
      }
    }
    return flat;
  }, [item, modifierGroups, selections]);

  if (!item) return null;

  const modifierAdd = selectedOptions.reduce((s, { option }) => s + (Number(option.priceAdjustment) || 0), 0);
  const unitPrice = item.price + modifierAdd;
  const lineTotal = unitPrice * qty;

  const toggle = (group: ModifierGroupView, optionId: string) => {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      const selectionType = group.selectionType ?? 'single';
      if (selectionType === 'single') return { ...prev, [group.id]: [optionId] };
      const exists = current.includes(optionId);
      const max = group.maxSelections ?? 99;
      let next: string[];
      if (exists) next = current.filter((x) => x !== optionId);
      else if (current.length >= max) next = [...current.slice(1), optionId];
      else next = [...current, optionId];
      return { ...prev, [group.id]: next };
    });
  };

  const canConfirm = modifierGroups.every((g) => {
    const min = g.minSelections ?? 0;
    return (selections[g.id]?.length ?? 0) >= min;
  });

  const handleConfirm = () => {
    onConfirm({
      itemId: item.id,
      name: item.name,
      basePrice: item.price,
      sizePriceAdd: modifierAdd,
      toppings: selectedOptions.map(({ group, option }) => ({
        code: `${group.code}:${option.code}`,
        name: `${group.name}: ${option.name}`,
        priceAdd: Number(option.priceAdjustment) || 0,
      })),
      note: note.trim() || undefined,
      quantity: qty,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{item.name}</DialogTitle>
        </DialogHeader>

        {modifierGroups.map((g) => {
          const selectionType = g.selectionType ?? 'single';
          return (
            <div key={g.id}>
              <div className="text-sm font-medium mb-2">
                {g.name}
                {(g.minSelections ?? 0) > 0 && <span className="text-destructive"> *</span>}
                {selectionType !== 'single' && (
                  <span className="text-xs text-muted-foreground ml-1">
                    (tối đa {g.maxSelections ?? g.options.length})
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.options.filter((o) => o.isActive !== false).map((o) => {
                  const active = (selections[g.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(g, o.id)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition ${
                        active
                          ? 'border-[hsl(var(--pos-accent))] bg-[hsl(var(--pos-accent-soft))] pos-accent-text font-medium'
                          : 'hover:bg-accent'
                      }`}
                    >
                      {o.name}
                      {Number(o.priceAdjustment) !== 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          {Number(o.priceAdjustment) > 0 ? '+' : ''}{formatVnd(Number(o.priceAdjustment))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div>
          <div className="text-sm font-medium mb-2">Ghi chú</div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ít ngọt, ít đá..." rows={2} />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              <Minus className="w-4 h-4" />
            </Button>
            <div className="w-8 text-center font-semibold">{qty}</div>
            <Button variant="outline" size="icon" onClick={() => setQty((q) => q + 1)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <Button disabled={!canConfirm} onClick={handleConfirm} className="pos-accent-bg hover:opacity-90">
            Thêm vào đơn · {formatVnd(lineTotal)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
