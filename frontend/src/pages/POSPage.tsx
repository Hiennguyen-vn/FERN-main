import { useOutletContext } from 'react-router-dom';
import { POSModule } from '@/components/pos/POSModule';
import type { ShellScope } from '@/types/shell';

interface ShellContext {
  scope: ShellScope;
  user: { id: string; displayName: string; email: string; persona: string; avatarInitials: string };
}

export default function POSPage() {
  const { scope, user } = useOutletContext<ShellContext>();
  return (
    <POSModule
      outletName={scope.outletName || 'Downtown Flagship'}
      operatorName={user.displayName}
    />
  );
}
