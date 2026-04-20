import { Clock, CheckCircle2, CreditCard, Layers, XCircle } from 'lucide-react';
import type { CustomerOrderQueueFilter } from '@/components/pos/customer-order-queue';

interface Counts {
  all: number;
  waiting: number;
  approved: number;
  paid: number;
  cancelled: number;
}

interface Props {
  active: CustomerOrderQueueFilter;
  counts: Counts;
  onChange: (f: CustomerOrderQueueFilter) => void;
  outletName?: string;
}

export function QrQueueSidebar({ active, counts, onChange, outletName }: Props) {
  return (
    <aside className="w-24 shrink-0 bg-white border-r flex flex-col items-center py-4 gap-1">
      <div className="w-14 h-14 rounded-2xl pos-accent-bg flex items-center justify-center mb-3 shadow-md">
        <Layers className="w-7 h-7" />
      </div>
      <div className="text-[11px] font-semibold tracking-wide">QR</div>
      <div className="text-[10px] text-muted-foreground mb-3 px-1 text-center truncate w-full">{outletName ?? ''}</div>

      <Btn icon={<Layers className="w-5 h-5" />} label="Tất cả" count={counts.all} active={active === 'all'} onClick={() => onChange('all')} />
      <Btn icon={<Clock className="w-5 h-5" />} label="Chờ duyệt" count={counts.waiting} active={active === 'waiting'} onClick={() => onChange('waiting')} />
      <Btn icon={<CheckCircle2 className="w-5 h-5" />} label="Đã duyệt" count={counts.approved} active={active === 'approved'} onClick={() => onChange('approved')} />
      <Btn icon={<CreditCard className="w-5 h-5" />} label="Đã TT" count={counts.paid} active={active === 'paid'} onClick={() => onChange('paid')} />
      <Btn icon={<XCircle className="w-5 h-5" />} label="Đã hủy" count={counts.cancelled} active={active === 'cancelled'} onClick={() => onChange('cancelled')} />
    </aside>
  );
}

function Btn({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pos-sidebar-btn relative w-20 h-16 rounded-xl flex flex-col items-center justify-center gap-1 transition ${
        active ? 'active' : 'hover:bg-[hsl(var(--pos-accent-soft))]'
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium line-clamp-1 px-1 text-center">{label}</span>
      <span className={`absolute top-1 right-2 text-[10px] rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center font-semibold ${
        active ? 'bg-white/25 text-white' : 'pos-accent-bg'
      }`}>
        {count}
      </span>
    </button>
  );
}
