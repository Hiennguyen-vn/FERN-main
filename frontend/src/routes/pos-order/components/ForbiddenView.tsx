import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface Props {
  title?: string;
  message?: string;
}

export function ForbiddenView({ title = 'Không có quyền truy cập', message }: Props) {
  return (
    <div className="pos-order-root min-h-screen flex items-center justify-center bg-[hsl(var(--pos-bg))] p-6">
      <div className="max-w-md w-full bg-white rounded-xl border shadow-sm p-8 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 text-destructive inline-flex items-center justify-center">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div>
          <div className="text-lg font-semibold">{title}</div>
          {message && <div className="text-sm text-muted-foreground mt-1">{message}</div>}
        </div>
        <div className="flex gap-2 justify-center">
          <Button asChild variant="outline">
            <Link to="/dashboard">Về Dashboard</Link>
          </Button>
          <Button asChild>
            <Link to="/login">Đăng nhập lại</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
