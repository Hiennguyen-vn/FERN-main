import { useOutletContext } from 'react-router-dom';
import { OutletDashboard } from '@/components/dashboard/OutletDashboard';
import type { ShellScope } from '@/types/shell';

interface ShellContext {
  scope: ShellScope;
  user: { id: string; displayName: string; email: string; persona: string; avatarInitials: string };
}

export default function DashboardPage() {
  const { scope } = useOutletContext<ShellContext>();
  return <OutletDashboard scope={scope} />;
}
