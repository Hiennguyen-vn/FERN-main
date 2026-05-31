import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import type { SavedOrder } from '../hooks/use-order-history';
import { formatDateTime, formatVnd } from '../utils/format';
import { buildLineSubtitle, lineUnitPrice } from '../utils/line-modifiers';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: SavedOrder | null;
}

const methodLabel: Record<string, string> = {
  cash: 'Tiền mặt',
  card: 'Thẻ',
  qr: 'QR',
  voucher: 'Voucher',
};

export function OrderPrintPreview({ open, onOpenChange, order }: Props) {
  if (!order) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0 print:hidden">
          <DialogTitle className="text-base">Hóa đơn + KOT</DialogTitle>
          <Button variant="ghost" size="sm" aria-label="Print order documents" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> In
          </Button>
        </DialogHeader>

        <div className="pos-print-area p-6 font-mono text-[13px] leading-relaxed bg-white">
          <ReceiptSection order={order} />
          <div className="border-t-2 border-dashed my-5" />
          <KotSection order={order} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptSection({ order }: { order: SavedOrder }) {
  return (
    <section>
      <div className="text-center">
        <div className="text-lg font-bold tracking-wider">BEAN COFFEE</div>
        <div className="text-xs">123 Nguyễn Huệ, Q.1, TP.HCM</div>
        <div className="text-xs">Hotline: 1900 1234</div>
      </div>
      <Divider />

      <Row left="Đơn:" right={`#${order.orderNo}`} bold />
      <Row left="Ngày:" right={formatDateTime(order.createdAt)} />
      <Row left="Loại:" right={order.orderType === 'takeaway' ? 'Mang đi' : 'Tại quầy'} />
      {order.customerName && <Row left="Khách:" right={order.customerName} />}

      <Divider />
      <div className="flex justify-between text-xs font-bold">
        <span>Món</span>
        <span>SL</span>
        <span>T.Tiền</span>
      </div>
      <Divider />

      {order.lines.map((l) => {
        const subtitle = buildLineSubtitle(l);
        const unit = lineUnitPrice(l);
        return (
          <div key={l.lineId} className="mb-1">
            <div className="flex justify-between gap-2">
              <span className="font-semibold flex-1 truncate">{l.name}</span>
              <span className="w-6 text-center">{l.quantity}</span>
              <span className="w-20 text-right">{formatVnd(unit * l.quantity)}</span>
            </div>
            {subtitle && <div className="text-[11px] opacity-70">{subtitle}</div>}
            {l.note && <div className="text-[11px] italic opacity-70">{l.note}</div>}
          </div>
        );
      })}

      <Divider />
      <Row left="Tạm tính:" right={formatVnd(order.subtotal)} />
      {order.discount > 0 && <Row left="Giảm giá:" right={`-${formatVnd(order.discount)}`} />}
      <Row left="VAT 8%:" right={formatVnd(order.vat)} />
      <div className="border-t pt-1 mt-1">
        <Row left="TỔNG CỘNG:" right={formatVnd(order.total)} bold />
      </div>
      <Row left="Thanh toán:" right={methodLabel[order.paymentMethod] ?? order.paymentMethod} />

      <Divider />
      <div className="text-center font-bold">CẢM ƠN QUÝ KHÁCH!</div>
      <div className="text-center text-xs mt-1">Hẹn gặp lại</div>
    </section>
  );
}

function KotSection({ order }: { order: SavedOrder }) {
  return (
    <section>
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
              <div className="text-base font-bold">x {l.quantity} {l.name}</div>
              {subtitle && <div className="text-sm mt-0.5">{subtitle}</div>}
              {l.note && <div className="text-sm italic mt-0.5">Ghi chú: {l.note}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Row({ left, right, bold }: { left: string; right: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed my-2" />;
}
