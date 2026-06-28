import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingSnapshot, SubmitPhase } from '../hooks/use-submit-order';

function phaseLabel(phase: SubmitPhase): string {
  switch (phase) {
    case 'create_failed': return 'tạo đơn thất bại';
    case 'approve_failed': return 'duyệt thất bại';
    case 'payment_failed': return 'thanh toán thất bại';
    case 'creating': return 'đang tạo đơn';
    case 'created': return 'đã tạo — chờ duyệt';
    case 'approved': return 'đã duyệt — chờ thanh toán';
    default: return 'chưa hoàn tất';
  }
}

interface Props {
  snapshot: PendingSnapshot;
  onResume: () => void;
  onDiscard: () => void;
  isResuming?: boolean;
}

export function PendingSubmitBanner({ snapshot, onResume, onDiscard, isResuming }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-sm">
      <div className="flex items-start gap-2 text-warning-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-medium">Có đơn chưa hoàn tất trong phiên này</div>
          <div className="text-xs opacity-90">
            {snapshot.lines.length} món · {phaseLabel(snapshot.phase)}
            {snapshot.error ? ` · ${snapshot.error}` : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 pos-accent-bg hover:opacity-90" onClick={onResume} disabled={isResuming}>
          Tiếp tục xử lý
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onDiscard} disabled={isResuming}>
          Bỏ qua
        </Button>
      </div>
    </div>
  );
}
