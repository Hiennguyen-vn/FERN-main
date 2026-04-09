import { useState, useMemo } from 'react';
import {
  Search, Plus, User, Phone, Mail, Star, Award, ShoppingBag,
  Calendar, ArrowLeft, Edit2, Save, X as XIcon, Hash, Clock,
  ChevronRight, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { POSCustomer, LoyaltyEvent } from '@/types/pos';
import { mockCustomers, mockLoyaltyEvents, LOYALTY_TIER_CONFIG } from '@/data/mock-pos-extended';
import { RouteUnavailableBanner } from '@/components/pos/PlatformGapStates';

type CustomerView =
  | { screen: 'search' }
  | { screen: 'create' }
  | { screen: 'profile'; customerId: string }
  | { screen: 'edit'; customerId: string };

interface Props {
  onBack: () => void;
  onAttach?: (customer: POSCustomer) => void;
  gatewayAvailable?: boolean;
}

export function CustomerPanel({ onBack, onAttach, gatewayAvailable = false }: Props) {
  const [view, setView] = useState<CustomerView>({ screen: 'search' });

  if (!gatewayAvailable) {
    return (
      <div className="p-6 space-y-4 animate-fade-in">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <RouteUnavailableBanner
          title="Customer Management"
          subtitle="Customer CRUD and lookup APIs exist in the backend source, but are not yet exposed through the gateway."
          routePath="/api/customers/**"
          missingPermissions={['pos.customer.read', 'pos.customer.write']}
        />
      </div>
    );
  }

  if (view.screen === 'search') {
    return <CustomerSearch onBack={onBack} onAttach={onAttach} onView={(id) => setView({ screen: 'profile', customerId: id })} onCreate={() => setView({ screen: 'create' })} />;
  }
  if (view.screen === 'create') {
    return <CustomerForm onBack={() => setView({ screen: 'search' })} onSave={() => setView({ screen: 'search' })} />;
  }
  if (view.screen === 'profile') {
    return <CustomerProfile customerId={view.customerId} onBack={() => setView({ screen: 'search' })} onEdit={() => setView({ screen: 'edit', customerId: view.customerId })} onAttach={onAttach} />;
  }
  if (view.screen === 'edit') {
    const customer = mockCustomers.find(c => c.id === view.customerId);
    return <CustomerForm customer={customer} onBack={() => setView({ screen: 'profile', customerId: view.customerId })} onSave={() => setView({ screen: 'profile', customerId: view.customerId })} />;
  }
  return null;
}

/* ── Customer Search ── */
function CustomerSearch({ onBack, onAttach, onView, onCreate }: {
  onBack: () => void;
  onAttach?: (c: POSCustomer) => void;
  onView: (id: string) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    if (!query.trim()) return mockCustomers;
    const q = query.toLowerCase();
    return mockCustomers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.memberCode && c.memberCode.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Customer Lookup</h2>
            <p className="text-xs text-muted-foreground">Search by name, phone, email, or member code</p>
          </div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" /> Quick Create
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search customers — name, phone, member code…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-10 h-10"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        {results.length === 0 ? (
          <div className="text-center py-12">
            <User className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No customers found</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different search or create a new customer</p>
          </div>
        ) : (
          results.map(customer => (
            <div
              key={customer.id}
              className="surface-elevated p-3.5 flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors group"
              onClick={() => onView(customer.id)}
            >
              <div className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                customer.loyaltyTier ? LOYALTY_TIER_CONFIG[customer.loyaltyTier]?.color || 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground'
              )}>
                {customer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{customer.name}</p>
                  {customer.loyaltyTier && (
                    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border', LOYALTY_TIER_CONFIG[customer.loyaltyTier]?.color)}>
                      {LOYALTY_TIER_CONFIG[customer.loyaltyTier]?.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{customer.phone}</span>
                  {customer.memberCode && <span className="text-xs text-muted-foreground flex items-center gap-1"><Hash className="h-2.5 w-2.5" />{customer.memberCode}</span>}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-medium text-foreground">{customer.loyaltyPoints} pts</p>
                <p className="text-[10px] text-muted-foreground">{customer.visitCount} visits</p>
              </div>
              {onAttach && (
                <Button
                  variant="outline" size="sm" className="h-7 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); onAttach(customer); }}
                >
                  Attach
                </Button>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Customer Create / Update Form ── */
function CustomerForm({ customer, onBack, onSave }: {
  customer?: POSCustomer;
  onBack: () => void;
  onSave: () => void;
}) {
  const isEdit = !!customer;
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [notes, setNotes] = useState(customer?.notes || '');

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-lg">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{isEdit ? 'Update Customer' : 'Quick Create Customer'}</h2>
          <p className="text-xs text-muted-foreground">{isEdit ? 'Edit customer information' : 'Lightweight operational entry'}</p>
        </div>
      </div>

      <div className="surface-elevated p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Full Name *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Customer name" className="h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Phone *</label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+65 XXXX XXXX" className="h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Email</label>
          <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className="h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1.5 block">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Dietary preferences, seating preferences…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-none"
          />
        </div>
        {isEdit && customer?.loyaltyTier && (
          <div className="p-3 rounded-lg bg-muted/30 border">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Loyalty</p>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded border', LOYALTY_TIER_CONFIG[customer.loyaltyTier]?.color)}>
                {LOYALTY_TIER_CONFIG[customer.loyaltyTier]?.label}
              </span>
              <span className="text-xs text-foreground">{customer.loyaltyPoints} points</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onBack}>Cancel</Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onSave} disabled={!name.trim() || !phone.trim()}>
          <Save className="h-3.5 w-3.5" /> {isEdit ? 'Update Customer' : 'Create Customer'}
        </Button>
      </div>
    </div>
  );
}

/* ── Customer Profile ── */
function CustomerProfile({ customerId, onBack, onEdit, onAttach }: {
  customerId: string;
  onBack: () => void;
  onEdit: () => void;
  onAttach?: (c: POSCustomer) => void;
}) {
  const customer = mockCustomers.find(c => c.id === customerId);
  const events = mockLoyaltyEvents.filter(e => e.customerId === customerId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const [tab, setTab] = useState<'overview' | 'loyalty'>('overview');

  if (!customer) return <div className="p-6 text-sm text-muted-foreground">Customer not found</div>;

  const tierConfig = customer.loyaltyTier ? LOYALTY_TIER_CONFIG[customer.loyaltyTier] : null;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold text-foreground">Customer Profile</h2>
        </div>
        <div className="flex items-center gap-2">
          {onAttach && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onAttach(customer)}>Attach to Order</Button>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onEdit}>
            <Edit2 className="h-3 w-3" /> Edit
          </Button>
        </div>
      </div>

      {/* Identity card */}
      <div className="surface-elevated p-5">
        <div className="flex items-start gap-4">
          <div className={cn(
            'h-14 w-14 rounded-full flex items-center justify-center text-base font-semibold flex-shrink-0',
            tierConfig?.color || 'bg-muted text-muted-foreground'
          )}>
            {customer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground">{customer.name}</h3>
              {tierConfig && (
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded border', tierConfig.color)}>
                  {tierConfig.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{customer.phone}</span>
              {customer.email && <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{customer.email}</span>}
              {customer.memberCode && <span className="text-xs text-muted-foreground flex items-center gap-1.5"><Hash className="h-3 w-3" />{customer.memberCode}</span>}
            </div>
            {customer.notes && (
              <p className="text-xs text-muted-foreground mt-2 italic">{customer.notes}</p>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Points', value: customer.loyaltyPoints.toLocaleString(), icon: Star },
          { label: 'Total Spend', value: `$${customer.totalSpend.toLocaleString()}`, icon: ShoppingBag },
          { label: 'Visits', value: customer.visitCount.toString(), icon: Calendar },
          { label: 'Last Visit', value: customer.lastVisit || '—', icon: Clock },
        ].map(s => (
          <div key={s.label} className="surface-elevated p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <s.icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{s.label}</span>
            </div>
            <p className="text-sm font-semibold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b flex items-center gap-0">
        {(['overview', 'loyalty'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >{t === 'loyalty' ? 'Loyalty History' : 'Overview'}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="surface-elevated p-5">
          <h4 className="text-sm font-semibold text-foreground mb-3">Recent Activity</h4>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {events.slice(0, 5).map(ev => (
                <div key={ev.id} className="flex items-center justify-between p-2.5 rounded-md bg-muted/20">
                  <div className="flex items-center gap-2.5">
                    <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px]',
                      ev.type === 'earn' ? 'bg-success/10 text-success' :
                      ev.type === 'redeem' ? 'bg-primary/10 text-primary' :
                      ev.type === 'adjust' ? 'bg-info/10 text-info' :
                      'bg-muted text-muted-foreground'
                    )}>
                      {ev.type === 'earn' ? '+' : ev.type === 'redeem' ? '−' : ev.type === 'adjust' ? '★' : '⊘'}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">{ev.description}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(ev.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className={cn('text-xs font-semibold', ev.points > 0 ? 'text-success' : 'text-muted-foreground')}>
                    {ev.points > 0 ? '+' : ''}{ev.points} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'loyalty' && <LoyaltyHistory events={events} />}
    </div>
  );
}

/* ── Loyalty History ── */
function LoyaltyHistory({ events }: { events: LoyaltyEvent[] }) {
  const totalEarned = events.filter(e => e.type === 'earn' || (e.type === 'adjust' && e.points > 0)).reduce((s, e) => s + e.points, 0);
  const totalRedeemed = events.filter(e => e.type === 'redeem').reduce((s, e) => s + Math.abs(e.points), 0);
  const totalExpired = events.filter(e => e.type === 'expire').reduce((s, e) => s + Math.abs(e.points), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Earned', value: totalEarned, color: 'text-success' },
          { label: 'Redeemed', value: totalRedeemed, color: 'text-primary' },
          { label: 'Expired', value: totalExpired, color: 'text-muted-foreground' },
        ].map(s => (
          <div key={s.label} className="surface-elevated p-3.5 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
            <p className={cn('text-lg font-semibold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="surface-elevated p-5">
        <h4 className="text-sm font-semibold text-foreground mb-3">Timeline</h4>
        <div className="relative">
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
          <div className="space-y-3">
            {events.map(ev => (
              <div key={ev.id} className="flex items-start gap-3 relative">
                <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 z-10 border-2 border-background',
                  ev.type === 'earn' ? 'bg-success/15 text-success' :
                  ev.type === 'redeem' ? 'bg-primary/15 text-primary' :
                  ev.type === 'adjust' ? 'bg-info/15 text-info' :
                  'bg-muted text-muted-foreground'
                )}>
                  {ev.type === 'earn' ? '+' : ev.type === 'redeem' ? '−' : ev.type === 'adjust' ? '★' : '⊘'}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{ev.description}</p>
                    <span className={cn('text-xs font-semibold', ev.points > 0 ? 'text-success' : 'text-muted-foreground')}>
                      {ev.points > 0 ? '+' : ''}{ev.points}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(ev.createdAt).toLocaleDateString()} · {new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
