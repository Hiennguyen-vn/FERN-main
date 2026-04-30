import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { lookupCustomer, eraseCustomer, type LoyaltyCustomer } from '@/api/admin-api';

export function LoyaltyPage() {
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<LoyaltyCustomer | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const lookup = useMutation({
    mutationFn: () => lookupCustomer(phone.trim()),
    onSuccess: (c) => { setCustomer(c); setConfirmErase(false); },
    onError: () => { setCustomer(null); },
  });

  const erase = useMutation({
    mutationFn: (id: number) => eraseCustomer(id),
    onSuccess: () => { setCustomer(null); setConfirmErase(false); },
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Loyalty Customers</h2>
        <p className="text-xs text-muted-foreground">
          Lookup by phone. Erase respects PDPL right-to-erasure (soft-delete).
        </p>
      </div>

      <div className="flex items-end gap-2">
        <label className="text-xs">
          Phone
          <input className="block border rounded px-2 py-1 text-xs w-64"
                 value={phone} onChange={e => setPhone(e.target.value)} />
        </label>
        <button className="border rounded px-3 py-1 text-xs"
                onClick={() => lookup.mutate()}
                disabled={!phone.trim() || lookup.isPending}>Lookup</button>
      </div>

      {lookup.error && (
        <div className="text-xs text-red-600">Customer not found.</div>
      )}

      {customer && (
        <div className="border rounded p-4 grid grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">ID</div><div>{customer.id}</div>
          <div className="text-muted-foreground">Phone</div><div>{customer.phone}</div>
          <div className="text-muted-foreground">Name</div><div>{customer.fullName ?? '—'}</div>
          <div className="text-muted-foreground">Birthday</div><div>{customer.birthday ?? '—'}</div>
          <div className="text-muted-foreground">Verified</div><div>{customer.phoneVerified ? 'yes' : 'no'}</div>
          <div className="text-muted-foreground">Marketing consent</div><div>{customer.consentMarketing ? 'yes' : 'no'}</div>
          <div className="text-muted-foreground">Points</div><div className="font-semibold">{customer.pointsBalance}</div>
          <div className="col-span-2 mt-2">
            {!confirmErase ? (
              <button className="text-xs border rounded px-3 py-1 text-red-600"
                      onClick={() => setConfirmErase(true)}>
                Erase (PDPL)
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-red-600 text-xs">Confirm permanent erase?</span>
                <button className="text-xs border rounded px-3 py-1 bg-red-600 text-white"
                        onClick={() => erase.mutate(customer.id)}
                        disabled={erase.isPending}>Yes, erase</button>
                <button className="text-xs border rounded px-3 py-1"
                        onClick={() => setConfirmErase(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
