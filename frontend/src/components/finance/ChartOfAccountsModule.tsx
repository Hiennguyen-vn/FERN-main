import { useState } from 'react';
import {
  ChevronRight, ChevronDown, Plus, Search, FolderTree, Edit2, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
  isActive: boolean;
  children?: Account[];
}

const INITIAL_COA: Account[] = [
  { id: '1', code: '1000', name: 'Assets', type: 'asset', balance: 485000, isActive: true, children: [
    { id: '1a', code: '1100', name: 'Cash & Bank', type: 'asset', balance: 125000, isActive: true, children: [
      { id: '1a1', code: '1110', name: 'Petty Cash', type: 'asset', balance: 5000, isActive: true },
      { id: '1a2', code: '1120', name: 'Bank – Operating', type: 'asset', balance: 95000, isActive: true },
      { id: '1a3', code: '1130', name: 'Bank – Savings', type: 'asset', balance: 25000, isActive: true },
    ]},
    { id: '1b', code: '1200', name: 'Accounts Receivable', type: 'asset', balance: 42000, isActive: true },
    { id: '1c', code: '1300', name: 'Inventory', type: 'asset', balance: 318000, isActive: true },
  ]},
  { id: '2', code: '2000', name: 'Liabilities', type: 'liability', balance: 180000, isActive: true, children: [
    { id: '2a', code: '2100', name: 'Accounts Payable', type: 'liability', balance: 67000, isActive: true },
    { id: '2b', code: '2200', name: 'Accrued Expenses', type: 'liability', balance: 23000, isActive: true },
    { id: '2c', code: '2300', name: 'Tax Payable', type: 'liability', balance: 15000, isActive: true },
    { id: '2d', code: '2400', name: 'Long-term Loans', type: 'liability', balance: 75000, isActive: true },
  ]},
  { id: '3', code: '3000', name: 'Equity', type: 'equity', balance: 305000, isActive: true, children: [
    { id: '3a', code: '3100', name: 'Share Capital', type: 'equity', balance: 200000, isActive: true },
    { id: '3b', code: '3200', name: 'Retained Earnings', type: 'equity', balance: 105000, isActive: true },
  ]},
  { id: '4', code: '4000', name: 'Revenue', type: 'revenue', balance: 890000, isActive: true, children: [
    { id: '4a', code: '4100', name: 'Sales Revenue', type: 'revenue', balance: 820000, isActive: true },
    { id: '4b', code: '4200', name: 'Service Revenue', type: 'revenue', balance: 50000, isActive: true },
    { id: '4c', code: '4300', name: 'Other Income', type: 'revenue', balance: 20000, isActive: true },
  ]},
  { id: '5', code: '5000', name: 'Expenses', type: 'expense', balance: 654000, isActive: true, children: [
    { id: '5a', code: '5100', name: 'Cost of Goods Sold', type: 'expense', balance: 356000, isActive: true },
    { id: '5b', code: '5200', name: 'Payroll Expense', type: 'expense', balance: 185000, isActive: true },
    { id: '5c', code: '5300', name: 'Rent & Utilities', type: 'expense', balance: 72000, isActive: true },
    { id: '5d', code: '5400', name: 'Marketing', type: 'expense', balance: 28000, isActive: true },
    { id: '5e', code: '5500', name: 'Depreciation', type: 'expense', balance: 13000, isActive: false },
  ]},
];

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const TYPE_COLORS: Record<string, string> = {
  asset: 'bg-primary/10 text-primary',
  liability: 'bg-warning/10 text-warning',
  equity: 'bg-success/10 text-success',
  revenue: 'bg-info/10 text-info',
  expense: 'bg-destructive/10 text-destructive',
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

/* helpers to work with tree */
function flattenAccounts(accounts: Account[]): Account[] {
  const result: Account[] = [];
  for (const a of accounts) {
    result.push(a);
    if (a.children) result.push(...flattenAccounts(a.children));
  }
  return result;
}

function filterTree(accounts: Account[], q: string): Account[] {
  if (!q) return accounts;
  const lower = q.toLowerCase();
  return accounts.reduce<Account[]>((acc, a) => {
    const childMatches = a.children ? filterTree(a.children, q) : [];
    const selfMatch = a.name.toLowerCase().includes(lower) || a.code.includes(q);
    if (selfMatch || childMatches.length > 0) {
      acc.push({ ...a, children: childMatches.length > 0 ? childMatches : a.children && selfMatch ? a.children : undefined });
    }
    return acc;
  }, []);
}

function addToTree(accounts: Account[], parentId: string | null, newAccount: Account): Account[] {
  if (!parentId) return [...accounts, newAccount];
  return accounts.map(a => {
    if (a.id === parentId) return { ...a, children: [...(a.children || []), newAccount] };
    if (a.children) return { ...a, children: addToTree(a.children, parentId, newAccount) };
    return a;
  });
}

function updateInTree(accounts: Account[], id: string, updates: Partial<Account>): Account[] {
  return accounts.map(a => {
    if (a.id === id) return { ...a, ...updates };
    if (a.children) return { ...a, children: updateInTree(a.children, id, updates) };
    return a;
  });
}

function removeFromTree(accounts: Account[], id: string): Account[] {
  return accounts.filter(a => a.id !== id).map(a => a.children ? { ...a, children: removeFromTree(a.children, id) } : a);
}

function isLeaf(accounts: Account[], id: string): boolean {
  const flat = flattenAccounts(accounts);
  const found = flat.find(a => a.id === id);
  return !found?.children || found.children.length === 0;
}

function AccountRow({ account, depth = 0, onEdit, onDelete }: { account: Account; depth?: number; onEdit: (a: Account) => void; onDelete: (a: Account) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = account.children && account.children.length > 0;

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors group">
        <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + depth * 24}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : (
              <span className="w-3" />
            )}
            <span className="text-xs font-mono text-muted-foreground">{account.code}</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-sm font-medium text-foreground">{account.name}</td>
        <td className="px-4 py-2.5">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize', TYPE_COLORS[account.type])}>
            {account.type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right font-mono text-sm">{fmt(account.balance)}</td>
        <td className="px-4 py-2.5">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
            account.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          )}>
            {account.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit(account)}><Edit2 className="h-3 w-3" /></Button>
            {!hasChildren && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => onDelete(account)}><Trash2 className="h-3 w-3" /></Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && hasChildren && account.children!.map(child => (
        <AccountRow key={child.id} account={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  );
}

const emptyForm = { code: '', name: '', type: 'asset', parentId: '', isActive: true };

export function ChartOfAccountsModule() {
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<Account[]>(INITIAL_COA);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm);

  const totalAccounts = flattenAccounts(accounts).length;
  const filtered = filterTree(accounts, search);

  const parentOptions = flattenAccounts(accounts);

  const openCreate = () => { setEditTarget(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (a: Account) => { setEditTarget(a); setForm({ code: a.code, name: a.name, type: a.type, parentId: '', isActive: a.isActive }); setDialogOpen(true); };

  const handleSave = () => {
    if (!form.code || !form.name) { toast.error('Code and name are required'); return; }
    if (editTarget) {
      setAccounts(prev => updateInTree(prev, editTarget.id, { code: form.code, name: form.name, type: form.type, isActive: form.isActive }));
      toast.success(`Account "${form.name}" updated`);
    } else {
      const newAcc: Account = { id: `acc-${Date.now()}`, code: form.code, name: form.name, type: form.type, balance: 0, isActive: form.isActive };
      setAccounts(prev => addToTree(prev, form.parentId || null, newAcc));
      toast.success(`Account "${form.name}" created`);
    }
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setAccounts(prev => removeFromTree(prev, deleteTarget.id));
    toast.success(`Account "${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Chart of Accounts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{totalAccounts} accounts in 5 categories</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}><Plus className="h-3 w-3" /> Add Account</Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-5 gap-3">
        {accounts.map(cat => (
          <div key={cat.id} className="surface-elevated p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{cat.name}</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{fmt(cat.balance)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{cat.children?.length || 0} sub-accounts</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Search accounts…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
      </div>

      {/* Table */}
      <div className="surface-elevated overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              {['Code', 'Account Name', 'Type', 'Balance', 'Status', ''].map(h => (
                <th key={h} className={cn('text-[11px] font-medium text-muted-foreground px-4 py-2.5', h === 'Balance' ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(account => (
              <AccountRow key={account.id} account={account} onEdit={openEdit} onDelete={a => setDeleteTarget(a)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Account' : 'Add Account'}</DialogTitle>
            <DialogDescription>{editTarget ? 'Update account details' : 'Create a new account in the chart'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Account Code</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. 1110" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Account Type</Label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Account Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Petty Cash" className="h-9 text-sm" />
            </div>
            {!editTarget && (
              <div className="space-y-1.5">
                <Label className="text-xs">Parent Account (optional)</Label>
                <select value={form.parentId} onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— Top Level —</option>
                  {parentOptions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editTarget ? 'Save Changes' : 'Create Account'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
