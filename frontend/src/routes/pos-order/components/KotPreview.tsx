import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import type { SavedOrder } from '../hooks/use-order-history';
import { formatDateTime } from '../utils/format';
import { buildLineSubtitle } from '../utils/line-modifiers';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: SavedOrder | null;
}

export function KotPreview({ open, onOpenChange, order }: Props) {
  if (!order) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0">
        <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0 print:hidden">
          <DialogTitle className="text-base">Phiếu pha chế (KOT)</DialogTitle>
          <Button variant="ghost" size="sm" aria-label="Print KOT" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> In
          </Button>
        </DialogHeader>

        <div className="pos-print-area p-6 font-mono bg-white">
          <div className="text-center">
            <div className="text-xl font-bold tracking-wider">PHIẾU PHA CHẾ</div>
            <div className="text-lg font-bold mt-1">#{order.orderNo}</div>
            <div className="text-xs">{formatDateTime(order.createdAt)}</div>
            <div className="text-sm font-bold mt-1">{order.orderType === 'takeaway' ? 'MANG ĐI' : 'TẠI QUẦY'}</div>
          </div>
          <div className="border-t border-dashed my-3" />

          <div className="space-y-3">
            {order.lines.map((l) => {
              const subtitle = buildLineSubtitle(l);
              return (
                <div key={l.lineId} className="border-b border-dashed pb-2">
                  <div className="text-base font-bold">× {l.quantity} {l.name}</div>
                  {subtitle && <div className="text-sm mt-0.5">{subtitle}</div>}
                  {l.note && <div className="text-sm italic mt-0.5">Ghi chú: {l.note}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
