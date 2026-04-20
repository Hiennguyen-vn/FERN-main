import { type ReactNode } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import type { ShellContext } from '@/types/shell';
import { resolveRolesForOutlet } from '../hooks/use-role-for-outlet';
import { ForbiddenView } from '../components/ForbiddenView';

interface Props {
  children: ReactNode;
}

export function PosRoleRedirect({ children }: Props) {
  const { session } = useAuth();
  const ctx = useOutletContext<ShellContext | undefined>();
  const activeOutletId = ctx?.scope?.outletId ?? null;

  const resolution = resolveRolesForOutlet(session, activeOutletId);

  if (!session?.accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (resolution.isStaffOnly) {
    const target = activeOutletId ? `/posorder?outlet=${activeOutletId}` : '/posorder';
    return <Navigate to={target} replace />;
  }
  if (!resolution.canSell && !resolution.isManager) {
    return <ForbiddenView message="Vai trò của bạn không có quyền vào màn POS." />;
  }
  return <>{children}</>;
}
