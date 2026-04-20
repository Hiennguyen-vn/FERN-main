import { AlertCircle, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SubmitPhase, SubmitError } from '../hooks/use-submit-order';

interface Props {
  phase: SubmitPhase;
  error?: SubmitError | null;
  onRetryCreate?: () => void;
  onRetryApprove?: () => void;
  onRetryPayment?: () => void;
  onDismiss?: () => void;
}

function friendlyTitle(phase: SubmitPhase) {
  switch (phase) {
    case 'creating': return 'Đang tạo đơn...';
    case 'approving': return 'Đang duyệt đơn...';
    case 'paying': return 'Đang ghi nhận thanh toán...';
    case 'created': return 'Đã tạo đơn — đang duyệt';
    case 'approved': return 'Đã duyệt — đang ghi nhận thanh toán';
    case 'create_failed': return 'Không tạo được đơn';
    case 'approve_failed': return 'Không duyệt được đơn';
    case 'payment_failed': return 'Thanh toán chưa ghi nhận';
    default: return '';
  }
}

function friendlyReason(err?: SubmitError | null): string | undefined {
  if (!err) return undefined;
  const s = err.status;
  if (s === 400) return 'Dữ liệu gửi lên không hợp lệ. Kiểm tra cấu hình menu và thử lại.';
  if (s === 401) return 'Phiên đăng nhập hết hạn. Đăng nhập lại.';
  if (s === 403) return 'Tài khoản không có quyền thực hiện.';
  if (s === 404) return 'Không tìm thấy đơn/outlet. Có thể dữ liệu đã bị thay đổi.';
  if (s === 409) {
    if (err.errorCode === 'idempotency_conflict') return 'Idempotency-Key đã dùng với payload khác. Tạo đơn mới.';
    return 'Xung đột dữ liệu. Tải lại và thử lại.';
  }
  if (s === 422) return 'Dữ liệu vi phạm ràng buộc (enum, constraint). Báo admin kiểm tra cấu hình.';
  if (s === 500 || s === 502 || s === 503) return 'Lỗi máy chủ. Thử lại sau hoặc báo admin.';
  return undefined;
}

export function SubmitStatusOverlay({ phase, error, onRetryCreate, onRetryApprove, onRetryPayment, onDismiss }: Props) {
  if (phase === 'idle' || phase === 'paid') return null;

  const isWorking = phase === 'creating' || phase === 'approving' || phase === 'paying';
  const isCreateFailed = phase === 'create_failed';
  const isApproveFailed = phase === 'approve_failed';
  const isPayFailed = phase === 'payment_failed';
  const isCreatedOnly = phase === 'created' || phase === 'approved';
  const reason = friendlyReason(error);

  const copyDetails = async () => {
    if (!error) return;
    const dump = JSON.stringify({
      status: error.status,
      errorCode: error.errorCode,
      message: error.message,
      details: error.details,
      at: new Date().toISOString(),
    }, null, 2);
    try {
      await navigator.clipboard.writeText(dump);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full inline-flex items-center justify-center bg-[hsl(var(--pos-accent-soft))]">
          {isWorking && <Loader2 className="w-7 h-7 animate-spin pos-accent-text" />}
          {isCreatedOnly && <CheckCircle2 className="w-7 h-7 pos-accent-text" />}
          {(isCreateFailed || isApproveFailed || isPayFailed) && <AlertCircle className="w-7 h-7 text-destructive" />}
        </div>
        <div>
          <div className="text-lg font-semibold">{friendlyTitle(phase)}</div>
          {error?.message && <div className="text-sm text-destructive mt-1 break-words">{error.message}</div>}
          {reason && <div className="text-xs text-muted-foreground mt-1">{reason}</div>}
          {error?.status && (
            <div className="text-[11px] text-muted-foreground mt-1">
              HTTP {error.status}{error.errorCode ? ` · ${error.errorCode}` : ''}
            </div>
          )}
          {isApproveFailed && (
            <div className="text-xs text-muted-foreground mt-2">
              Đơn đã tạo. Duyệt lại để tiếp tục thanh toán.
            </div>
          )}
          {isPayFailed && (
            <div className="text-xs text-muted-foreground mt-2">
              Đơn đã duyệt. Thử lại chỉ gửi lại lệnh thanh toán.
            </div>
          )}
          {isCreateFailed && (
            <div className="text-xs text-muted-foreground mt-2">
              Idempotency-Key giữ nguyên — thử lại sẽ không tạo đơn trùng.
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-center flex-wrap">
          {isCreateFailed && onRetryCreate && (
            <Button onClick={onRetryCreate} className="pos-accent-bg hover:opacity-90">Thử lại tạo đơn</Button>
          )}
          {isApproveFailed && onRetryApprove && (
            <Button onClick={onRetryApprove} className="pos-accent-bg hover:opacity-90">Thử lại duyệt</Button>
          )}
          {isPayFailed && onRetryPayment && (
            <Button onClick={onRetryPayment} className="pos-accent-bg hover:opacity-90">Thử lại thanh toán</Button>
          )}
          {(isCreateFailed || isApproveFailed || isPayFailed) && (
            <>
              <Button variant="outline" onClick={copyDetails}>
                <Copy className="w-3.5 h-3.5 mr-1" /> Copy lỗi
              </Button>
              {onDismiss && <Button variant="outline" onClick={onDismiss}>Đóng</Button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
