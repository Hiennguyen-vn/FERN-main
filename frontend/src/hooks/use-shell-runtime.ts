import { useOutletContext } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import type { ShellContext } from '@/types/shell';

export interface ShellRuntime {
  scope: ShellContext['scope'];
  user: ShellContext['user'];
  token: string;
}

export function useShellRuntime(): ShellRuntime {
  const outlet = useOutletContext<ShellContext>();
  const { session } = useAuth();

  return {
    scope: outlet.scope,
    user: outlet.user,
    token: session?.accessToken ?? '',
  };
}
