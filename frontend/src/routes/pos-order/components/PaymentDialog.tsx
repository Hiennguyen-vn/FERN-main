import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Banknote, CheckCircle2, CreditCard, Printer, QrCode, Ticket, UtensilsCrossed, X } from 'lucide-react';
import { formatVnd } from '../utils/format';

export type PayMethod = 'cash' | 'card' | 'qr' | 'voucher';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  orderNo: string;
  onConfirm: (method: PayMethod) => void;
  onPrintReceipt: () => void;
  onPrintKot: () => void;
  onNewOrder: () => void;
}

const QUICK = [50000, 100000, 200000, 500000];

export function PaymentDialog({ open, onOpenChange, total, orderNo, onConfirm, onPrintReceipt, onPrintKot, onNewOrder }: Props) {
  const [method, setMethod] = useState<PayMethod>('cash');
  const [tendered, setTendered] = useState<number>(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setMethod('cash');
      setTendered(0);
      setDone(false);
    }
  }, [open]);

  const change = Math.max(0, tendered - total);
  const canConfirm = method !== 'cash' || tendered >= total;

  const handleConfirm = () => {
    onConfirm(method);
    setDone(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 z-10 w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-accent"
        >
          <X className="w-4 h-4" />
        </button>

        {!done ? (
          <div className="p-6 space-y-5">
            <div className="text-xl font-bold">Thanh toán</div>

            <div className="pos-accent-soft-bg rounded-lg p-4 text-center">
              <div className="text-xs pos-accent-text font-medium mb-1">Tổng cần thanh toán</div>
              <div className="pos-accent-text text-3xl font-bold">{formatVnd(total)}</div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Phương thức thanh toán</div>
              <div className="grid grid-cols-2 gap-2">
                <MethodBtn icon={<Banknote className="w-5 h-5" />} label="Tiền mặt" active={method === 'cash'} onClick={() => setMethod('cash')} />
                <MethodBtn icon={<CreditCard className="w-5 h-5" />} label="Thẻ" active={method === 'card'} onClick={() => setMethod('card')} />
                <MethodBtn icon={<QrCode className="w-5 h-5" />} label="QR / Momo" active={method === 'qr'} onClick={() => setMethod('qr')} />
                <MethodBtn icon={<Ticket className="w-5 h-5" />} label="Voucher" active={method === 'voucher'} onClick={() => setMethod('voucher')} />
              </div>
            </div>

            {method === 'cash' && (
              <div>
                <div className="text-sm font-medium mb-2">Tiền khách đưa</div>
                <Input
                  type="number"
                  value={tendered || ''}
                  onChange={(e) => setTendered(Number(e.target.value) || 0)}
                  className="h-12 text-lg text-right"
                />
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setTendered(q)}
                      className="h-9 rounded-md border text-xs font-medium hover:bg-accent"
                    >
                      {q / 1000}k
                    </button>
                  ))}
                </div>
                {tendered > 0 && tendered >= total && (
                  <div className="mt-2 text-sm flex justify-between">
                    <span className="text-muted-foreground">Tiền thối</span>
                    <span className="font-semibold pos-accent-text">{formatVnd(change)}</span>
                  </div>
                )}
              </div>
            )}

            {method === 'qr' && (
              <div className="border rounded-lg p-6 flex flex-col items-center gap-3">
                <div className="w-36 h-36 bg-white border-2 rounded-md p-2 grid grid-cols-[1fr_1fr_1fr] grid-rows-[1fr_1fr_1fr] gap-1">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className={`${[0, 2, 6].includes(i) ? 'bg-foreground' : 'bg-foreground/20'} rounded-sm`} />
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">Quét mã để thanh toán</div>
              </div>
            )}

            <Button
              className="w-full h-12 pos-accent-bg hover:opacity-90 text-base font-semibold disabled:opacity-50"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              Xác nhận thanh toán
            </Button>
          </div>
        ) : (
          <div className="p-8 space-y-5 text-center">
            <div className="mx-auto w-20 h-20 rounded-full pos-success-bg flex items-center justify-center pos-pop">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <div>
              <div className="text-xl font-bold">Thanh toán thành công!</div>
              <div className="text-sm text-muted-foreground">Đơn #{orderNo}</div>
              <div className="pos-accent-text text-2xl font-bold mt-2">{formatVnd(total)}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-11" onClick={onPrintReceipt}>
                <Printer className="w-4 h-4 mr-1.5" /> In hóa đơn
              </Button>
              <Button variant="outline" className="h-11" onClick={onPrintKot}>
                <UtensilsCrossed className="w-4 h-4 mr-1.5" /> In KOT
              </Button>
            </div>
            <Button className="w-full h-12 pos-accent-bg hover:opacity-90 text-base font-semibold" onClick={onNewOrder}>
              Đơn mới
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MethodBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-20 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition ${
        active
          ? 'border-[hsl(var(--pos-accent))] pos-accent-soft-bg pos-accent-text'
          : 'hover:bg-accent border-border'
      }`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
