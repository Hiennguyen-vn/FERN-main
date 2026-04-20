import { useState } from 'react';
import { ClipboardList, Pencil, ShoppingBag, Store, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DraftOrder } from '../hooks/use-draft-orders';
import type { CartLine, OrderType } from '../hooks/use-pos-cart';
import { formatVnd } from '../utils/format';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drafts: DraftOrder[];
  onRestore: (draft: DraftOrder) => void;
  onDelete: (draftId: string) => void;
  onUpdate: (draftId: string, patch: Partial<Pick<DraftOrder, 'lines' | 'orderType' | 'customerName'>>) => void;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function draftTotal(lines: CartLine[]) {
  return lines.reduce((s, l) => {
    const unit = l.basePrice + (l.sizePriceAdd ?? 0) + l.toppings.reduce((t, x) => t + x.priceAdd, 0);
    return s + unit * l.quantity;
  }, 0);
}

export function DraftPickerDialog({ open, onOpenChange, drafts, onRestore, onDelete, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2 font-semibold">
            <ClipboardList className="w-5 h-5 pos-accent-text" /> Đơn lưu tạm
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[60vh]">
          {drafts.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">Không có đơn lưu tạm.</div>
          )}
          {drafts.map((d) => (
            <DraftRow
              key={d.draftId}
              draft={d}
              editing={editingId === d.draftId}
              onToggleEdit={() => setEditingId((prev) => (prev === d.draftId ? null : d.draftId))}
              onRestore={() => { onRestore(d); onOpenChange(false); }}
              onDelete={() => onDelete(d.draftId)}
              onUpdate={(patch) => onUpdate(d.draftId, patch)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  draft: DraftOrder;
  editing: boolean;
  onToggleEdit: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Pick<DraftOrder, 'lines' | 'orderType' | 'customerName'>>) => void;
}

function DraftRow({ draft, editing, onToggleEdit, onRestore, onDelete, onUpdate }: RowProps) {
  const [nameInput, setNameInput] = useState(draft.customerName);
  const [orderType, setOrderType] = useState<OrderType>(draft.orderType);
  const total = draftTotal(draft.lines);

  const handleSaveEdit = () => {
    onUpdate({ customerName: nameInput.trim(), orderType });
    onToggleEdit();
  };

  return (
    <div className="border-b last:border-0">
      <div className="flex items-start gap-3 px-5 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">#{draft.orderNo}</span>
            <span className="text-xs text-muted-foreground">{timeStr(draft.savedAt)}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              draft.orderType === 'takeaway'
                ? 'bg-[hsl(var(--pos-accent-soft))] pos-accent-text'
                : 'bg-muted text-muted-foreground'
            }`}>
              {draft.orderType === 'takeaway' ? 'Mang đi' : 'Tại quầy'}
            </span>
            {draft.customerName && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">{draft.customerName}</span>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {draft.lines.map((l) => `${l.name} ×${l.quantity}`).join(', ')}
          </div>
          <div className="mt-1 font-bold pos-accent-text text-sm">{formatVnd(total)}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onToggleEdit} title="Chỉnh sửa" className="w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-accent">
            <Pencil className="w-4 h-4" />
          </button>
          <button type="button" onClick={onDelete} title="Xóa" className="w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
          <Button size="sm" className="h-8 pos-accent-bg hover:opacity-90" onClick={onRestore}>Mở đơn</Button>
        </div>
      </div>

      {editing && (
        <div className="px-5 pb-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOrderType('takeaway')}
              className={`h-9 rounded-md border inline-flex items-center justify-center gap-2 text-sm font-medium transition ${
                orderType === 'takeaway'
                  ? 'border-[hsl(var(--pos-accent))] pos-accent-soft-bg pos-accent-text'
                  : 'hover:bg-accent'
              }`}
            >
              <ShoppingBag className="w-4 h-4" /> Mang đi
            </button>
            <button
              type="button"
              onClick={() => setOrderType('dinein')}
              className={`h-9 rounded-md border inline-flex items-center justify-center gap-2 text-sm font-medium transition ${
                orderType === 'dinein'
                  ? 'border-[hsl(var(--pos-accent))] pos-accent-soft-bg pos-accent-text'
                  : 'hover:bg-accent'
              }`}
            >
              <Store className="w-4 h-4" /> Tại quầy
            </button>
          </div>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Tên khách (tùy chọn)"
          />
          <div className="space-y-2">
            {draft.lines.map((l) => (
              <LineEditor
                key={l.lineId}
                line={l}
                onChange={(updated) => {
                  const next = draft.lines.map((x) => (x.lineId === l.lineId ? updated : x));
                  onUpdate({ lines: next });
                }}
                onRemove={() => {
                  onUpdate({ lines: draft.lines.filter((x) => x.lineId !== l.lineId) });
                }}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onToggleEdit}>Hủy</Button>
            <Button size="sm" className="pos-accent-bg hover:opacity-90" onClick={handleSaveEdit}>Lưu</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LineEditor({ line, onChange, onRemove }: { line: CartLine; onChange: (l: CartLine) => void; onRemove: () => void }) {
  const unit = line.basePrice + (line.sizePriceAdd ?? 0) + line.toppings.reduce((s, t) => s + t.priceAdd, 0);
  return (
    <div className="flex items-center gap-3 text-sm bg-white rounded-md px-3 py-2 border">
      <span className="flex-1 truncate">{line.name}</span>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" className="w-6 h-6 rounded border inline-flex items-center justify-center hover:bg-accent" onClick={() => { if (line.quantity > 1) onChange({ ...line, quantity: line.quantity - 1 }); }}>−</button>
        <span className="w-6 text-center font-mono">{line.quantity}</span>
        <button type="button" className="w-6 h-6 rounded border inline-flex items-center justify-center hover:bg-accent" onClick={() => onChange({ ...line, quantity: line.quantity + 1 })}>+</button>
      </div>
      <span className="w-20 text-right pos-accent-text font-semibold">{formatVnd(unit * line.quantity)}</span>
      <button type="button" onClick={onRemove} className="w-6 h-6 rounded inline-flex items-center justify-center hover:text-destructive">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
