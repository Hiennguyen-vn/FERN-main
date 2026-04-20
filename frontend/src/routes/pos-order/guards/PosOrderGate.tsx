import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import PosOrderPage from '../PosOrderPage';
import { useActiveOutlet } from '../hooks/use-active-outlet';
import { ForbiddenView } from '../components/ForbiddenView';

export function PosOrderGate() {
  const { session, loading } = useAuth();
  const outlet = useActiveOutlet();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Đang khởi tạo phiên...
      </div>
    );
  }
  if (!session?.accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (outlet.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Đang tải thông tin outlet...
      </div>
    );
  }
  if (outlet.errorMessage) {
    return <ForbiddenView message={outlet.errorMessage} />;
  }
  if (!outlet.outletId) {
    return <ForbiddenView message="Không tìm thấy outlet phù hợp cho tài khoản." />;
  }
  return (
    <PosOrderPage
      outletId={outlet.outletId}
      outletName={outlet.outletName}
      currencyCode={outlet.currencyCode}
      outlets={outlet.outlets}
      setOutletId={outlet.setOutletId}
    />
  );
}

export default PosOrderGate;
