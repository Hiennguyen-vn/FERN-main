import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClipboardList } from 'lucide-react';

interface Props {
  open: boolean;
  outletName: string;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (args: { sessionCode: string; openingCash: number; note?: string }) => Promise<unknown>;
}

export function OpenShiftDialog({ open, outletName, isSubmitting, error, onSubmit }: Props) {
  const [sessionCode, setSessionCode] = useState(() => `POS-${Date.now().toString().slice(-6)}`);
  const [openingCash, setOpeningCash] = useState<string>('0');
  const [note, setNote] = useState('');

  const handleSubmit = async () => {
    await onSubmit({ sessionCode: sessionCode.trim(), openingCash: Number(openingCash) || 0, note: note.trim() || undefined });
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 pos-accent-text" /> Mở ca bán hàng
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          Outlet: <span className="font-medium text-foreground">{outletName}</span>
        </div>
        <div className="space-y-3 pt-2">
          <div>
            <div className="text-xs font-medium mb-1">Mã ca</div>
            <Input value={sessionCode} onChange={(e) => setSessionCode(e.target.value)} className="h-10" />
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Tiền đầu ca</div>
            <Input type="number" inputMode="numeric" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} className="h-10 text-right" />
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Ghi chú (tùy chọn)</div>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-10" />
          </div>
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
        <Button className="w-full h-11 pos-accent-bg hover:opacity-90 mt-2" disabled={isSubmitting || !sessionCode.trim()} onClick={handleSubmit}>
          {isSubmitting ? 'Đang mở ca...' : 'Mở ca'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
