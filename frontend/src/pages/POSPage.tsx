import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { CustomerOrdersWorkspace } from '@/components/pos/CustomerOrdersWorkspace';
import { POSModule } from '@/components/pos/POSModule';
import type { ShellScope } from '@/types/shell';

interface ShellContext {
  scope: ShellScope;
  user: { id: string; displayName: string; email: string; persona: string; avatarInitials: string };
}

export default function POSPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { scope, user } = useOutletContext<ShellContext>();

  if (searchParams.get('tab') === 'customer-orders') {
    return (
      <CustomerOrdersWorkspace
        surfaceLabel="Customer Orders"
        onBack={() => navigate('/pos')}
      />
    );
  }

  return (
    <POSModule
      outletName={scope.outletName || 'Downtown Flagship'}
      operatorName={user.displayName}
      onCustomerOrders={() => navigate('/pos?tab=customer-orders')}
    />
  );
}
