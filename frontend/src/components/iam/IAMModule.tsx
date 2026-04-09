import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield,
  Users,
  Key,
  Globe,
  ShieldAlert,
  Eye,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  authApi,
  type AuthSessionRow,
  type AuthPermissionOverrideView,
  type AuthScopeView,
  type AuthUserListItem,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { EmptyState, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import { useAuth } from '@/auth/use-auth';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';

type IAMView = 'dashboard' | 'users' | 'roles' | 'permissions' | 'scopes' | 'overrides' | 'effective-access';

const IAM_TABS: { key: IAMView; label: string; icon: React.ElementType }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: Shield },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles', icon: Key },
  { key: 'permissions', label: 'Permissions', icon: Shield },
  { key: 'scopes', label: 'Scopes', icon: Globe },
  { key: 'overrides', label: 'Overrides', icon: ShieldAlert },
  { key: 'effective-access', label: 'Effective Access', icon: Eye },
];

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export function IAMModule() {
  const { token, scope } = useShellRuntime();
  const { session } = useAuth();
  const outletId = normalizeNumeric(scope.outletId);

  const [view, setView] = useState<IAMView>('dashboard');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [sessions, setSessions] = useState<AuthSessionRow[]>([]);

  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersHasMore, setUsersHasMore] = useState(false);

  const [scopes, setScopes] = useState<AuthScopeView[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesError, setScopesError] = useState('');
  const [scopesTotal, setScopesTotal] = useState(0);
  const [scopesHasMore, setScopesHasMore] = useState(false);

  const [overrides, setOverrides] = useState<AuthPermissionOverrideView[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [overridesError, setOverridesError] = useState('');
  const [overridesTotal, setOverridesTotal] = useState(0);
  const [overridesHasMore, setOverridesHasMore] = useState(false);

  const usersQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'updatedAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const scopesQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'username',
    initialSortDir: 'asc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const overridesQuery = useListQueryState<{ outletId?: string; status?: string }>({
    initialLimit: 20,
    initialSortBy: 'assignedAt',
    initialSortDir: 'desc',
    initialFilters: { outletId: outletId || undefined, status: undefined },
  });
  const patchUserFilters = usersQuery.patchFilters;
  const patchScopeFilters = scopesQuery.patchFilters;
  const patchOverrideFilters = overridesQuery.patchFilters;

  const [createUserForm, setCreateUserForm] = useState({
    username: '',
    password: '',
    fullName: '',
    employeeCode: '',
    email: '',
    role: '',
    permissions: '',
  });

  const [roleForm, setRoleForm] = useState({
    roleCode: '',
    permissionCodes: '',
  });

  const loadSessions = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setSessions([]);
      return;
    }

    setLoading(true);
    try {
      const sessionRows = await authApi.sessions(token);
      setSessions(Array.isArray(sessionRows) ? sessionRows : []);
    } catch (error) {
      console.error('IAM session load failed:', error);
      toast.error('Unable to load IAM session data');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setUsersLoading(true);
    setUsersError('');
    try {
      const page = await authApi.users(token, {
        ...usersQuery.query,
        outletId: outletId || undefined,
      });
      setUsers(page.items || []);
      setUsersTotal(page.total || page.totalCount || 0);
      setUsersHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('IAM users load failed:', error);
      setUsers([]);
      setUsersTotal(0);
      setUsersHasMore(false);
      setUsersError(getErrorMessage(error, 'Unable to load users'));
    } finally {
      setUsersLoading(false);
    }
  }, [outletId, token, usersQuery.query]);

  const loadScopes = useCallback(async () => {
    if (!token) return;
    setScopesLoading(true);
    setScopesError('');
    try {
      const page = await authApi.scopes(token, {
        ...scopesQuery.query,
        outletId: outletId || undefined,
      });
      setScopes(page.items || []);
      setScopesTotal(page.total || page.totalCount || 0);
      setScopesHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('IAM scopes load failed:', error);
      setScopes([]);
      setScopesTotal(0);
      setScopesHasMore(false);
      setScopesError(getErrorMessage(error, 'Unable to load scopes'));
    } finally {
      setScopesLoading(false);
    }
  }, [outletId, scopesQuery.query, token]);

  const loadOverrides = useCallback(async () => {
    if (!token) return;
    setOverridesLoading(true);
    setOverridesError('');
    try {
      const page = await authApi.overrides(token, {
        ...overridesQuery.query,
        outletId: outletId || undefined,
      });
      setOverrides(page.items || []);
      setOverridesTotal(page.total || page.totalCount || 0);
      setOverridesHasMore(page.hasMore || page.hasNextPage || false);
    } catch (error: unknown) {
      console.error('IAM overrides load failed:', error);
      setOverrides([]);
      setOverridesTotal(0);
      setOverridesHasMore(false);
      setOverridesError(getErrorMessage(error, 'Unable to load overrides'));
    } finally {
      setOverridesLoading(false);
    }
  }, [outletId, overridesQuery.query, token]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // Keep IAM tab data aligned with active outlet scope.
    patchUserFilters({ outletId: outletId || undefined });
    patchScopeFilters({ outletId: outletId || undefined });
    patchOverrideFilters({ outletId: outletId || undefined });
    setUsers([]);
    setUsersTotal(0);
    setUsersHasMore(false);
    setUsersError('');
    setScopes([]);
    setScopesTotal(0);
    setScopesHasMore(false);
    setScopesError('');
    setOverrides([]);
    setOverridesTotal(0);
    setOverridesHasMore(false);
    setOverridesError('');
  }, [outletId, patchOverrideFilters, patchScopeFilters, patchUserFilters, token]);

  useEffect(() => {
    if (view !== 'users') return;
    void loadUsers();
  }, [loadUsers, view]);

  useEffect(() => {
    if (view !== 'scopes') return;
    void loadScopes();
  }, [loadScopes, view]);

  useEffect(() => {
    if (view !== 'overrides') return;
    void loadOverrides();
  }, [loadOverrides, view]);

  const sessionStats = useMemo(() => {
    const active = sessions.filter((row) => String(row.state || '').toLowerCase() === 'active').length;
    const revoked = sessions.filter((row) => String(row.state || '').toLowerCase() === 'revoked').length;
    const current = sessions.filter((row) => Boolean(row.current)).length;
    return { active, revoked, current };
  }, [sessions]);

  const revokeSession = async (sessionId: string) => {
    if (!token) return;
    setBusyKey(`revoke:${sessionId}`);
    try {
      await authApi.revokeSession(token, sessionId);
      toast.success('Session revoked');
      await loadSessions();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to revoke session'));
    } finally {
      setBusyKey('');
    }
  };

  const createUser = async () => {
    if (!token) return;

    if (!createUserForm.username.trim() || !createUserForm.password || !createUserForm.fullName.trim()) {
      toast.error('Username, password, and full name are required');
      return;
    }

    const roles = createUserForm.role
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const permissions = createUserForm.permissions
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const assignmentOutletId = outletId || normalizeNumeric(Object.keys(session?.rolesByOutlet || {})[0]);

    setBusyKey('create-user');
    try {
      await authApi.createUser(token, {
        username: createUserForm.username.trim(),
        password: createUserForm.password,
        fullName: createUserForm.fullName.trim(),
        employeeCode: createUserForm.employeeCode.trim() || null,
        email: createUserForm.email.trim() || null,
        outletAccess: assignmentOutletId
          ? [
              {
                outletId: assignmentOutletId,
                roles,
                permissions,
              },
            ]
          : [],
      });

      toast.success('User created');
      setCreateUserForm({
        username: '',
        password: '',
        fullName: '',
        employeeCode: '',
        email: '',
        role: '',
        permissions: '',
      });
      await loadUsers();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to create user'));
    } finally {
      setBusyKey('');
    }
  };

  const replaceRolePermissions = async () => {
    if (!token) return;
    if (!roleForm.roleCode.trim() || !roleForm.permissionCodes.trim()) {
      toast.error('Role code and permission codes are required');
      return;
    }

    const permissionCodes = roleForm.permissionCodes
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    setBusyKey('replace-role-permissions');
    try {
      await authApi.replaceRolePermissions(token, roleForm.roleCode.trim(), permissionCodes);
      toast.success('Role permissions updated');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Unable to update role permissions'));
    } finally {
      setBusyKey('');
    }
  };

  if (!token) {
    return <ServiceUnavailablePage state="service_unavailable" moduleName="IAM" />;
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="border-b bg-card px-6 flex items-center gap-0 flex-shrink-0">
        {IAM_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors',
              view === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {!loading && view === 'dashboard' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Current User', value: session?.user?.username || '—', icon: Users },
                { label: 'Active Sessions', value: String(sessionStats.active), icon: Shield },
                { label: 'Current Sessions', value: String(sessionStats.current), icon: Eye },
                { label: 'Revoked Sessions', value: String(sessionStats.revoked), icon: ShieldAlert },
              ].map((kpi) => (
                <div key={kpi.label} className="surface-elevated p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
                  </div>
                  <p className="text-xl font-semibold truncate">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="surface-elevated overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Session', 'State', 'Issued', 'Expires', 'Current', 'Client', ''].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No sessions found</td></tr>
                  ) : sessions.map((row) => {
                    const sessionId = String(row.sessionId || '');
                    const state = String(row.state || 'unknown').toLowerCase();
                    return (
                      <tr key={sessionId} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{sessionId}</td>
                        <td className="px-4 py-2.5 text-xs">{state}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.issuedAt)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.expiresAt)}</td>
                        <td className="px-4 py-2.5 text-xs">{row.current ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{String(row.userAgent || '—')}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => void revokeSession(sessionId)}
                            disabled={row.current || state === 'revoked' || busyKey === `revoke:${sessionId}`}
                            className="h-7 px-2.5 rounded border text-[10px] hover:bg-accent disabled:opacity-50"
                          >
                            {busyKey === `revoke:${sessionId}` ? 'Revoking...' : 'Revoke'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!loading && view === 'users' ? (
          <div className="space-y-4">
            <div className="surface-elevated p-4">
              <h3 className="text-sm font-semibold mb-3">Create User</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Username</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.username}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, username: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Password</label>
                  <input
                    type="password"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.password}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, password: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Full Name</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.fullName}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, fullName: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Employee Code</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.employeeCode}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, employeeCode: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Email</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.email}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Roles (comma-separated)</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.role}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, role: event.target.value }))}
                    placeholder="cashier,manager"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Permissions (comma-separated)</label>
                  <input
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={createUserForm.permissions}
                    onChange={(event) => setCreateUserForm((prev) => ({ ...prev, permissions: event.target.value }))}
                    placeholder="sales.order.read,sales.order.write"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => void createUser()}
                    disabled={busyKey === 'create-user'}
                    className="h-9 w-full rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
                  >
                    {busyKey === 'create-user' ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </div>
            </div>

            <div className="surface-elevated p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="text-sm font-semibold">Users ({usersTotal})</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                      placeholder="Search users"
                      value={usersQuery.searchInput}
                      onChange={(event) => usersQuery.setSearchInput(event.target.value)}
                    />
                  </div>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={usersQuery.filters.status || 'all'}
                    onChange={(event) => usersQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="locked">Locked</option>
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={`${usersQuery.sortBy || 'updatedAt'}:${usersQuery.sortDir}`}
                    onChange={(event) => {
                      const [field, direction] = event.target.value.split(':');
                      usersQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                    }}
                  >
                    <option value="updatedAt:desc">Updated ↓</option>
                    <option value="updatedAt:asc">Updated ↑</option>
                    <option value="username:asc">Username A-Z</option>
                    <option value="username:desc">Username Z-A</option>
                    <option value="status:asc">Status A-Z</option>
                    <option value="status:desc">Status Z-A</option>
                  </select>
                  <button
                    onClick={() => void loadUsers()}
                    disabled={usersLoading}
                    className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', usersLoading ? 'animate-spin' : '')} />
                    Refresh
                  </button>
                </div>
              </div>

              {usersError ? <p className="text-xs text-destructive">{usersError}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {['Username', 'Name', 'Status', 'Email', 'Employee Code', 'Updated'].map((header) => (
                        <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading && users.length === 0 ? (
                      <ListTableSkeleton columns={6} rows={6} />
                    ) : users.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No users found</td></tr>
                    ) : users.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{row.username || '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{row.fullName || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.status || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.email || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.employeeCode || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.updatedAt || row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ListPaginationControls
                total={usersTotal}
                limit={usersQuery.limit}
                offset={usersQuery.offset}
                hasMore={usersHasMore}
                disabled={usersLoading}
                onPageChange={usersQuery.setPage}
                onLimitChange={usersQuery.setPageSize}
              />
            </div>
          </div>
        ) : null}

        {!loading && view === 'roles' ? (
          <div className="surface-elevated p-4 space-y-3">
            <h3 className="text-sm font-semibold">Replace Role Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Role Code</label>
                <input
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={roleForm.roleCode}
                  onChange={(event) => setRoleForm((prev) => ({ ...prev, roleCode: event.target.value }))}
                  placeholder="manager"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Permission Codes (comma-separated)</label>
                <input
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={roleForm.permissionCodes}
                  onChange={(event) => setRoleForm((prev) => ({ ...prev, permissionCodes: event.target.value }))}
                  placeholder="sales.order.read,sales.order.write"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void replaceRolePermissions()}
                disabled={busyKey === 'replace-role-permissions'}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60"
              >
                {busyKey === 'replace-role-permissions' ? 'Saving...' : 'Replace Permissions'}
              </button>
              <button
                onClick={() => {
                  setRoleForm({ roleCode: '', permissionCodes: '' });
                }}
                className="h-9 px-3 rounded-md border text-xs font-medium hover:bg-accent"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}

        {!loading && view === 'permissions' ? (
          <EmptyState
            title="Permission catalog endpoint missing"
            description="The backend does not currently expose a read API for permission catalog discovery in this module."
          />
        ) : null}

        {!loading && view === 'scopes' ? (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Scope Assignments ({scopesTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search scopes"
                    value={scopesQuery.searchInput}
                    onChange={(event) => scopesQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={scopesQuery.filters.status || 'all'}
                  onChange={(event) => scopesQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="locked">Locked</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${scopesQuery.sortBy || 'username'}:${scopesQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    scopesQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="username:asc">Username A-Z</option>
                  <option value="username:desc">Username Z-A</option>
                  <option value="outletName:asc">Outlet A-Z</option>
                  <option value="outletName:desc">Outlet Z-A</option>
                </select>
                <button
                  onClick={() => void loadScopes()}
                  disabled={scopesLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', scopesLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>

            {scopesError ? <p className="text-xs text-destructive">{scopesError}</p> : null}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['User', 'Outlet', 'Roles', 'Permissions', 'Status'].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopesLoading && scopes.length === 0 ? (
                    <ListTableSkeleton columns={5} rows={6} />
                  ) : scopes.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No scope assignments found</td></tr>
                  ) : scopes.map((row, index) => (
                    <tr key={`${row.userId}:${row.outletId}:${index}`} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs">
                        <p className="font-medium">{row.fullName || row.username || '—'}</p>
                        <p className="text-muted-foreground">{row.username || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {row.outletName || row.outletCode || row.outletId || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{row.roles.length > 0 ? row.roles.join(', ') : '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {row.permissions.length > 0 ? row.permissions.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.userStatus || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ListPaginationControls
              total={scopesTotal}
              limit={scopesQuery.limit}
              offset={scopesQuery.offset}
              hasMore={scopesHasMore}
              disabled={scopesLoading}
              onPageChange={scopesQuery.setPage}
              onLimitChange={scopesQuery.setPageSize}
            />
          </div>
        ) : null}

        {!loading && view === 'overrides' ? (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h3 className="text-sm font-semibold">Permission Overrides ({overridesTotal})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className="h-8 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                    placeholder="Search overrides"
                    value={overridesQuery.searchInput}
                    onChange={(event) => overridesQuery.setSearchInput(event.target.value)}
                  />
                </div>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={overridesQuery.filters.status || 'all'}
                  onChange={(event) => overridesQuery.setFilter('status', event.target.value === 'all' ? undefined : event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="locked">Locked</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={`${overridesQuery.sortBy || 'assignedAt'}:${overridesQuery.sortDir}`}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':');
                    overridesQuery.applySort(field, direction === 'asc' ? 'asc' : 'desc');
                  }}
                >
                  <option value="assignedAt:desc">Assigned ↓</option>
                  <option value="assignedAt:asc">Assigned ↑</option>
                  <option value="username:asc">Username A-Z</option>
                  <option value="username:desc">Username Z-A</option>
                  <option value="permissionCode:asc">Permission A-Z</option>
                  <option value="permissionCode:desc">Permission Z-A</option>
                </select>
                <button
                  onClick={() => void loadOverrides()}
                  disabled={overridesLoading}
                  className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', overridesLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
              </div>
            </div>

            {overridesError ? <p className="text-xs text-destructive">{overridesError}</p> : null}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['User', 'Outlet', 'Permission', 'Assigned At', 'Status'].map((header) => (
                      <th key={header} className="text-left text-[11px] px-4 py-2.5">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overridesLoading && overrides.length === 0 ? (
                    <ListTableSkeleton columns={5} rows={6} />
                  ) : overrides.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No overrides found</td></tr>
                  ) : overrides.map((row, index) => (
                    <tr key={`${row.userId}:${row.outletId}:${row.permissionCode}:${index}`} className="border-b last:border-0">
                      <td className="px-4 py-2.5 text-xs">
                        <p className="font-medium">{row.fullName || row.username || '—'}</p>
                        <p className="text-muted-foreground">{row.username || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {row.outletName || row.outletCode || row.outletId || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{row.permissionName || row.permissionCode || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(row.assignedAt)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.userStatus || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ListPaginationControls
              total={overridesTotal}
              limit={overridesQuery.limit}
              offset={overridesQuery.offset}
              hasMore={overridesHasMore}
              disabled={overridesLoading}
              onPageChange={overridesQuery.setPage}
              onLimitChange={overridesQuery.setPageSize}
            />
          </div>
        ) : null}

        {!loading && view === 'effective-access' ? (
          <div className="surface-elevated p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Effective Access Snapshot</h3>
              <button
                onClick={() => void loadSessions()}
                className="h-8 px-2.5 rounded border text-[11px] flex items-center gap-1 hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border bg-muted/20">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">User</p>
                <p className="text-sm font-medium mt-1">{session?.user?.fullName || session?.user?.username || '—'}</p>
                <p className="text-xs text-muted-foreground">{session?.user?.username || '—'}</p>
              </div>
              <div className="p-3 rounded-lg border bg-muted/20">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Scope</p>
                <p className="text-sm font-medium mt-1">Outlet {outletId || 'N/A'}</p>
                <p className="text-xs text-muted-foreground">Based on active shell scope</p>
              </div>
            </div>
            <div className="surface-elevated overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left text-[11px] px-4 py-2.5">Outlet</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Roles</th>
                    <th className="text-left text-[11px] px-4 py-2.5">Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(session?.rolesByOutlet || {}).length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">No role assignments available in current session.</td></tr>
                  ) : Object.entries(session?.rolesByOutlet || {}).map(([outlet, roles]) => {
                    const permissions = session?.permissionsByOutlet?.[outlet] || [];
                    return (
                      <tr key={outlet} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs font-mono">{outlet}</td>
                        <td className="px-4 py-2.5 text-xs">{roles.length > 0 ? roles.join(', ') : '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{permissions.length > 0 ? permissions.join(', ') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
