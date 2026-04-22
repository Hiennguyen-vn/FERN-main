import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Eye,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  auditApi,
  authApi,
  orgApi,
  type AuditLogView,
  type AuditSecurityEvent,
  type AuthBusinessRoleCatalogItem,
  type AuthPermissionCatalogItem,
  type AuthPermissionOverrideView,
  type AuthRoleCatalogItem,
  type AuthScopeView,
  type AuthSessionRow,
  type AuthUserListItem,
  type ScopeOutlet,
  type ScopeRegion,
} from '@/api/fern-api';
import { getErrorMessage } from '@/api/decoders';
import { hasIamRoleManagementAccess, hasIamUserManagementAccess, isSuperadminSession } from '@/auth/authorization';
import { useAuth } from '@/auth/use-auth';
import {
  buildDirectoryMeta,
  buildFanOutPreview,
  buildLegacyMappingRows,
  buildOutletAccessRows,
  buildPermissionReferences,
  buildRoleComparison,
  buildRoleReferences,
  collapseAssignments,
  computeEffectiveAccess,
  IAM_PERMISSION_CODES,
  IAM_SENSITIVE_PERMISSION_CODES,
  type CollapsedAssignment,
  type EffectiveAccessRow,
  type IamScopeType,
  type IamSourceType,
  type IamTone,
  type RoleReference,
} from '@/components/iam/iam-blueprint';
import { EmptyState, PermissionBanner, ServiceUnavailablePage } from '@/components/shell/PermissionStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ListPaginationControls } from '@/components/ui/list-pagination-controls';
import { ListTableSkeleton } from '@/components/ui/list-table-skeleton';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import { cn } from '@/lib/utils';

/* ─── Types ─── */

type IamView = 'overview' | 'users' | 'assignments' | 'roles' | 'permissions' | 'effective-access' | 'audit' | 'security';
type DetailTab = 'assignments' | 'permissions' | 'effective-access' | 'activity';
type AssignmentMode = 'outlet' | 'region';
type RoleWorkspaceTab = 'canonical' | 'legacy' | 'compare';
type AccessWorkspaceTab = 'by-user' | 'by-outlet';
type AuditWorkspaceTab = 'changes' | 'sensitive' | 'login-mfa';

const NAV_ITEMS: { key: IamView; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'assignments', label: 'Assignments', icon: Workflow },
  { key: 'roles', label: 'Roles', icon: KeyRound },
  { key: 'permissions', label: 'Permissions', icon: ShieldAlert },
  { key: 'effective-access', label: 'Effective Access', icon: Eye },
  { key: 'audit', label: 'Audit Log', icon: ShieldCheck },
  { key: 'security', label: 'Security', icon: Settings2 },
];

const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'assignments', label: 'Roles' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'effective-access', label: 'Effective Access' },
  { key: 'activity', label: 'Activity' },
];

/* ─── Helpers ─── */

function normalizeNumeric(value: string | undefined) {
  const trimmed = String(value ?? '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : '';
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function formatRelativeTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const diffMs = parsed.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return fmt.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return fmt.format(hours, 'hour');
  return fmt.format(Math.round(hours / 24), 'day');
}

function userDateField(user: AuthUserListItem, keys: string[]) {
  for (const key of keys) {
    const value = user[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function initials(name?: string | null) {
  const text = String(name || '').trim();
  if (!text) return '?';
  return text.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

function summarizeScope(a: CollapsedAssignment) {
  if (a.scopeType === 'global') return `@ ${a.scopeName}`;
  if (a.scopeType === 'region') return `~ ${a.scopeName} (${a.outletCount})`;
  return `* ${a.scopeName}`;
}

/* ─── Styling helpers ─── */

function scopeColor(s: IamScopeType) {
  if (s === 'global') return 'border-violet-300 bg-violet-50 text-violet-700';
  if (s === 'region') return 'border-indigo-300 bg-indigo-50 text-indigo-700';
  return 'border-slate-300 bg-slate-50 text-slate-600';
}

function sourceColor(s: IamSourceType) {
  if (s === 'canonical') return 'border-blue-300 bg-blue-50 text-blue-700';
  if (s === 'legacy') return 'border-orange-300 bg-orange-50 text-orange-700';
  if (s === 'permission') return 'border-amber-300 bg-amber-50 text-amber-700';
  if (s === 'read_floor') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  return 'border-red-300 bg-red-50 text-red-700';
}

function toneColor(t: IamTone) {
  if (t === 'danger') return 'border-red-300 bg-red-50 text-red-700';
  if (t === 'warning') return 'border-amber-300 bg-amber-50 text-amber-700';
  if (t === 'info') return 'border-blue-300 bg-blue-50 text-blue-700';
  if (t === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  return 'border-border bg-muted/30 text-foreground';
}

function statusColor(s: string) {
  const n = s.toLowerCase();
  if (n === 'active') return 'bg-emerald-500';
  if (n === 'locked') return 'bg-red-500';
  if (n === 'suspended') return 'bg-slate-400';
  return 'bg-blue-500';
}

/* ─── Micro-components ─── */

function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('h-1.5 w-1.5 rounded-full', statusColor(status))} />
      {status || 'unknown'}
    </span>
  );
}

function ScopePill({ scopeType, label }: { scopeType: IamScopeType; label: string }) {
  return <Badge variant="outline" className={cn('text-[10px] font-normal', scopeColor(scopeType))}>{label}</Badge>;
}

function SourceBadge({ sourceType, label }: { sourceType: IamSourceType | 'canonical' | 'legacy'; label: string }) {
  return <Badge variant="outline" className={cn('text-[10px] font-normal', sourceColor(sourceType as IamSourceType))}>{label}</Badge>;
}

function RoleBadge({ label, tone }: { label: string; tone: IamTone }) {
  return <Badge variant="outline" className={cn('text-[10px] font-normal', toneColor(tone))}>{label}</Badge>;
}

function EffectBadge({ effect }: { effect: 'allow' | 'deny' }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] font-normal', effect === 'allow' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700')}>
      {effect === 'allow' ? 'Allow' : 'Deny'}
    </Badge>
  );
}

/* ════════════════════════════════════════════════════════════════
   Main IAM Module
   ════════════════════════════════════════════════════════════════ */

export function IAMModule() {
  const { token, scope } = useShellRuntime();
  const { session } = useAuth();
  const scopedOutletId = normalizeNumeric(scope.outletId);
  const canManageUsers = hasIamUserManagementAccess(session);
  const canManageRoles = hasIamRoleManagementAccess(session);

  /* ── Scope context banner ── */
  const scopeContextBanner = useMemo(() => {
    if (!session) return null;
    if (isSuperadminSession(session)) return null; // superadmin sees everything, no banner needed
    // Collect outlet IDs where actor has 'admin' role
    const adminOutletIds = Object.entries(session.rolesByOutlet ?? {})
      .filter(([, roles]) => roles.includes('admin'))
      .map(([id]) => id);
    if (adminOutletIds.length === 0) return null;
    return adminOutletIds;
  }, [session]);

  /* ── View state ── */
  const [view, setView] = useState<IamView>('overview');
  const [detailTab, setDetailTab] = useState<DetailTab>('assignments');
  const [roleTab, setRoleTab] = useState<RoleWorkspaceTab>('canonical');
  const [accessTab, setAccessTab] = useState<AccessWorkspaceTab>('by-user');
  const [auditTab, setAuditTab] = useState<AuditWorkspaceTab>('changes');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userDetailOpen, setUserDetailOpen] = useState(false);
  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<AssignmentMode>('outlet');
  const [creatingUser, setCreatingUser] = useState(false);

  /* ── Filters ── */
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userScopeFilter, setUserScopeFilter] = useState<'all' | IamScopeType>('all');
  const [userRegionFilter, setUserRegionFilter] = useState('all');
  const [legacyOnly, setLegacyOnly] = useState(false);
  const [permSearch, setPermSearch] = useState('');
  const [permFilter, setPermFilter] = useState('all');
  const [accessDomainFilter, setAccessDomainFilter] = useState('all');
  const [accessEffectFilter, setAccessEffectFilter] = useState<'all' | 'allow' | 'deny'>('all');
  const [accessSourceFilter, setAccessSourceFilter] = useState<'all' | IamSourceType>('all');
  const [selectedOutletAccessId, setSelectedOutletAccessId] = useState(scopedOutletId || '');
  const [compareRoleCodes, setCompareRoleCodes] = useState<string[]>(['outlet_manager', 'procurement']);

  /* ── Data state ── */
  const [regions, setRegions] = useState<ScopeRegion[]>([]);
  const [outlets, setOutlets] = useState<ScopeOutlet[]>([]);
  const [hierarchyLoading, setHierarchyLoading] = useState(true);

  const [businessRoles, setBusinessRoles] = useState<AuthBusinessRoleCatalogItem[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<AuthRoleCatalogItem[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  const [permCatalog, setPermCatalog] = useState<AuthPermissionCatalogItem[]>([]);
  const [permCatalogLoading, setPermCatalogLoading] = useState(true);

  const [scopes, setScopes] = useState<AuthScopeView[]>([]);
  const [scopesLoading, setScopesLoading] = useState(true);

  const [overrides, setOverrides] = useState<AuthPermissionOverrideView[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(true);

  const [auditLogs, setAuditLogs] = useState<AuditLogView[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditHasMore, setAuditHasMore] = useState(false);

  const [secEvents, setSecEvents] = useState<AuditSecurityEvent[]>([]);
  const [secLoading, setSecLoading] = useState(true);

  const [sessions, setSessions] = useState<AuthSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [activityLogs, setActivityLogs] = useState<AuditLogView[]>([]);
  const [activityEvents, setActivityEvents] = useState<AuditSecurityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [pendingAction, setPendingAction] = useState<{ title: string; detail: string } | null>(null);
  const [sessionToRevoke, setSessionToRevoke] = useState<AuthSessionRow | null>(null);

  /* Assign-role dialog state */
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [assignRoleUserId, setAssignRoleUserId] = useState('');
  const [assignRoleUserName, setAssignRoleUserName] = useState('');
  const [assignRoleCode, setAssignRoleCode] = useState('');
  const [assignRoleOutletId, setAssignRoleOutletId] = useState('');
  const [assignRoleBusy, setAssignRoleBusy] = useState(false);

  /* Grant-permission dialog state */
  const [grantPermOpen, setGrantPermOpen] = useState(false);
  const [grantPermUserId, setGrantPermUserId] = useState('');
  const [grantPermCode, setGrantPermCode] = useState('');
  const [grantPermOutletId, setGrantPermOutletId] = useState('');
  const [grantPermBusy, setGrantPermBusy] = useState(false);

  /* Assignments search + pagination */
  const [assignSearch, setAssignSearch] = useState('');
  const [assignPage, setAssignPage] = useState(0);
  const assignPageSize = 20;

  /* Manage Role Permissions sheet */
  const [rolePermOpen, setRolePermOpen] = useState(false);
  const [rolePermCode, setRolePermCode] = useState('');
  const [rolePermBusy, setRolePermBusy] = useState(false);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  /* Revoke confirmations */
  const [revokeRoleTarget, setRevokeRoleTarget] = useState<{
    userId: string; outletId: string; roleCode: string; userName: string; roleName: string;
  } | null>(null);
  const [revokePermTarget, setRevokePermTarget] = useState<{
    userId: string; outletId: string; permissionCode: string; userName: string; permName: string;
  } | null>(null);

  const usersQuery = useListQueryState<{ outletId?: string; status?: string; regionId?: string; roleCode?: string }>({
    initialLimit: 25, initialSortBy: 'username', initialSortDir: 'asc',
    initialFilters: { outletId: scopedOutletId || undefined, status: undefined, regionId: undefined, roleCode: undefined },
  });
  const auditQuery = useListQueryState<{ module?: string }>({
    initialLimit: 25, initialSortBy: 'createdAt', initialSortDir: 'desc',
    initialFilters: { module: 'auth' },
  });

  const [users, setUsers] = useState<AuthUserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersHasMore, setUsersHasMore] = useState(false);

  const [assignForm, setAssignForm] = useState({
    username: '', password: '', fullName: '', employeeCode: '', email: '',
    roleCode: '', outletId: scopedOutletId || '', regionId: '',
  });

  /* ── Nav visibility ── */
  const navItems = useMemo(() => NAV_ITEMS.filter((n) => {
    if (n.key === 'assignments') return canManageUsers;
    return true;
  }), [canManageUsers]);

  const governanceBanner = useMemo(() => {
    if (canManageUsers && canManageRoles) return '';
    if (canManageUsers) return 'Role assignment is limited — auth.role.write is not assigned.';
    return 'Read-only access. Contact a superadmin to make changes.';
  }, [canManageRoles, canManageUsers]);

  /* ── Data loaders ── */
  const loadHierarchy = useCallback(async () => {
    if (!token) return;
    setHierarchyLoading(true);
    try {
      const d = await orgApi.hierarchy(token);
      setRegions(d.regions || []);
      setOutlets(d.outlets || []);
    } catch { setRegions([]); setOutlets([]); } finally { setHierarchyLoading(false); }
  }, [token]);

  const loadRoles = useCallback(async () => {
    if (!token) return;
    setRolesLoading(true);
    try {
      const [br, rc] = await Promise.all([
        authApi.businessRoles(token),
        authApi.roles(token, { limit: 50, offset: 0, sortBy: 'code', sortDir: 'asc' }),
      ]);
      setBusinessRoles(br); setRoleCatalog(rc.items || []);
    } catch { setBusinessRoles([]); setRoleCatalog([]); } finally { setRolesLoading(false); }
  }, [token]);

  const loadPermCatalog = useCallback(async () => {
    if (!token) return;
    setPermCatalogLoading(true);
    try {
      const p = await authApi.permissions(token, { limit: 100, offset: 0, sortBy: 'code', sortDir: 'asc' });
      setPermCatalog((p.items || []).filter((i) => IAM_PERMISSION_CODES.includes(i.code)));
    } catch { setPermCatalog([]); } finally { setPermCatalogLoading(false); }
  }, [token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setUsersLoading(true);
    try {
      // IAM module loads all users (no outlet filter) so region/outlet UI filters work.
      // The backend still scopes results based on the actor's governance permissions.
      const p = await authApi.users(token, { ...usersQuery.query });
      setUsers(p.items || []);
      setUsersTotal(p.total || p.totalCount || 0);
      setUsersHasMore(p.hasMore || p.hasNextPage || false);
    } catch (e: unknown) {
      setUsers([]); setUsersTotal(0); setUsersHasMore(false);
      toast.error(getErrorMessage(e, 'Unable to load users'));
    } finally { setUsersLoading(false); }
  }, [token, usersQuery.query]);

  const loadScopes = useCallback(async () => {
    if (!token) return;
    setScopesLoading(true);
    try {
      // Backend already scopes results to the actor's governed outlets.
      // Load pages until exhausted — backend enforces access boundaries.
      const allItems: AuthScopeView[] = [];
      let offset = 0;
      const pageSize = 500;
      let hasMore = true;
      while (hasMore) {
        const p = await authApi.scopes(token, { limit: pageSize, offset, sortBy: 'username', sortDir: 'asc' });
        allItems.push(...(p.items || []));
        hasMore = (p.hasMore || p.hasNextPage || false) && (p.items || []).length === pageSize;
        offset += pageSize;
        if (offset > 10000) break; // safety cap
      }
      setScopes(allItems);
    } catch { setScopes([]); } finally { setScopesLoading(false); }
  }, [token]);

  const loadOverrides = useCallback(async () => {
    if (!token) return;
    setOverridesLoading(true);
    try {
      const p = await authApi.overrides(token, { limit: 500, offset: 0, sortBy: 'createdAt', sortDir: 'desc' });
      setOverrides(p.items || []);
    } catch { setOverrides([]); } finally { setOverridesLoading(false); }
  }, [token]);

  const loadAudit = useCallback(async () => {
    if (!token) return;
    setAuditLoading(true);
    try {
      const p = await auditApi.logs(token, { ...auditQuery.query, module: 'auth' });
      setAuditLogs(p.items || []);
      setAuditTotal(p.total || p.totalCount || 0);
      setAuditHasMore(p.hasMore || p.hasNextPage || false);
    } catch { setAuditLogs([]); setAuditTotal(0); setAuditHasMore(false); } finally { setAuditLoading(false); }
  }, [auditQuery.query, token]);

  const loadSecEvents = useCallback(async () => {
    if (!token) return;
    setSecLoading(true);
    try {
      const p = await auditApi.securityEvents(token, { limit: 100, offset: 0, sortBy: 'createdAt', sortDir: 'desc' });
      setSecEvents(p.items || []);
    } catch { setSecEvents([]); } finally { setSecLoading(false); }
  }, [token]);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setSessionsLoading(true);
    try { setSessions(await authApi.sessions(token)); }
    catch { setSessions([]); } finally { setSessionsLoading(false); }
  }, [token]);

  const loadUserActivity = useCallback(async (userId: string) => {
    if (!token || !userId) return;
    setActivityLoading(true);
    try {
      const [al, se] = await Promise.all([
        auditApi.logs(token, { module: 'auth', entityId: userId, limit: 15, offset: 0, sortDir: 'desc' }),
        auditApi.securityEvents(token, { actorUserId: userId, limit: 15, offset: 0, sortDir: 'desc' }),
      ]);
      setActivityLogs(al.items || []);
      setActivityEvents(se.items || []);
    } catch { setActivityLogs([]); setActivityEvents([]); } finally { setActivityLoading(false); }
  }, [token]);

  /* ── Effects ── */
  useEffect(() => {
    if (!token) return;
    void loadHierarchy();
    void loadRoles();
    void loadPermCatalog();
    void loadScopes();
    void loadOverrides();
  }, [loadHierarchy, loadOverrides, loadPermCatalog, loadRoles, loadScopes, token]);

  useEffect(() => { if (token) void loadUsers(); }, [loadUsers, token]);
  useEffect(() => { if (token) void loadAudit(); }, [loadAudit, token]);
  useEffect(() => { if (token) { void loadSecEvents(); void loadSessions(); } }, [loadSecEvents, loadSessions, token]);

  useEffect(() => {
    if (!navItems.some((n) => n.key === view)) setView(navItems[0]?.key ?? 'overview');
  }, [navItems, view]);

  useEffect(() => {
    if (detailTab === 'activity' && selectedUserId) void loadUserActivity(selectedUserId);
  }, [detailTab, loadUserActivity, selectedUserId]);

  useEffect(() => {
    if (outlets.length > 0 && !selectedOutletAccessId) setSelectedOutletAccessId(scopedOutletId || String(outlets[0].id));
  }, [outlets, scopedOutletId, selectedOutletAccessId]);

  /* ── Derived data ── */
  const roleRefs = useMemo(() => buildRoleReferences(businessRoles, roleCatalog), [businessRoles, roleCatalog]);
  const permRefs = useMemo(() => buildPermissionReferences(permCatalog), [permCatalog]);
  const collapsed = useMemo(() => collapseAssignments(scopes, regions, outlets), [outlets, regions, scopes]);
  const dirMeta = useMemo(() => buildDirectoryMeta(collapsed), [collapsed]);
  const legacyRows = useMemo(() => buildLegacyMappingRows(collapsed), [collapsed]);
  const roleComparison = useMemo(() => buildRoleComparison(compareRoleCodes, roleRefs), [compareRoleCodes, roleRefs]);

  const assignmentsByUser = useMemo(() => {
    const m = new Map<string, CollapsedAssignment[]>();
    collapsed.forEach((a) => { const r = m.get(a.userId) ?? []; r.push(a); m.set(a.userId, r); });
    return m;
  }, [collapsed]);

  const outletRegionIds = useMemo(() => new Map(outlets.map((o) => [String(o.id), String(o.regionId)])), [outlets]);

  const filteredUsers = useMemo(() => users.filter((u) => {
    const meta = dirMeta.get(u.id);
    // role filter is handled server-side via usersQuery.filters.roleCode
    if (userScopeFilter !== 'all') {
      if (!meta) return false;
      if (meta.dominantScopeType !== userScopeFilter) return false;
    }
    // region filter is handled server-side via usersQuery.filters.regionId
    if (legacyOnly && (!meta || (meta.legacyLabels.length === 0 && meta.compatibilityOnlyLabels.length === 0))) return false;
    return true;
  }), [dirMeta, legacyOnly, userScopeFilter, users]);

  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) ?? null, [selectedUserId, users]);
  const selectedUserAssignments = useMemo(() => collapsed.filter((a) => a.userId === selectedUserId), [collapsed, selectedUserId]);
  const selectedUserOverrides = useMemo(() => overrides.filter((o) => o.userId === selectedUserId), [overrides, selectedUserId]);
  const selectedUserAccess = useMemo(() => selectedUserId ? computeEffectiveAccess(selectedUserId, collapsed, overrides, scopes, regions, outlets) : [], [collapsed, outlets, overrides, regions, scopes, selectedUserId]);

  const effectiveAccessFiltered = useMemo(() => selectedUserAccess.filter((r) => {
    if (accessDomainFilter !== 'all' && r.domain !== accessDomainFilter) return false;
    if (accessEffectFilter !== 'all' && r.effect !== accessEffectFilter) return false;
    if (accessSourceFilter !== 'all' && r.sourceType !== accessSourceFilter) return false;
    return true;
  }), [accessDomainFilter, accessEffectFilter, accessSourceFilter, selectedUserAccess]);

  const effectiveByDomain = useMemo(() => effectiveAccessFiltered.reduce<Record<string, EffectiveAccessRow[]>>((acc, r) => {
    acc[r.domain] = [...(acc[r.domain] || []), r]; return acc;
  }, {}), [effectiveAccessFiltered]);

  const filteredOverrides = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    return overrides.filter((r) => {
      if (permFilter !== 'all' && r.permissionCode !== permFilter) return false;
      if (q && ![r.fullName, r.username, r.permissionCode, r.permissionName, r.outletName].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [overrides, permFilter, permSearch]);

  const outletAccessRows = useMemo(
    () => buildOutletAccessRows(selectedOutletAccessId, collapsed, overrides, scopes, regions, outlets, roleRefs),
    [collapsed, outlets, overrides, regions, roleRefs, scopes, selectedOutletAccessId],
  );

  const filteredCollapsed = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return collapsed;
    return collapsed.filter((a) =>
      [a.fullName, a.username, a.canonicalRole, a.scopeName].join(' ').toLowerCase().includes(q),
    );
  }, [collapsed, assignSearch]);

  const pagedCollapsed = useMemo(
    () => filteredCollapsed.slice(assignPage * assignPageSize, (assignPage + 1) * assignPageSize),
    [filteredCollapsed, assignPage, assignPageSize],
  );

  const userIdToUsername = useMemo(
    () => new Map(users.map((u) => [u.id, u.username || u.fullName])),
    [users],
  );

  const auditSorted = useMemo(() => [...auditLogs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))), [auditLogs]);
  const sensitiveOverrides = useMemo(() => overrides.filter((r) => IAM_SENSITIVE_PERMISSION_CODES.has(r.permissionCode)), [overrides]);
  const sensitiveAudit = useMemo(() => auditSorted.filter((r) => [...IAM_SENSITIVE_PERMISSION_CODES].some((c) => JSON.stringify([r.action, r.entityName, r.newData]).toLowerCase().includes(c.toLowerCase()))), [auditSorted]);
  const loginEvents = useMemo(() => { const r = secEvents.filter((e) => ['login', 'mfa', 'password', 'session', 'auth'].some((t) => `${e.eventType || ''} ${e.action || ''}`.toLowerCase().includes(t))); return r.length > 0 ? r : secEvents; }, [secEvents]);

  const userActivityRows = useMemo(() => {
    const logs = activityLogs.map((r) => ({ id: `l:${r.id}`, createdAt: r.createdAt, title: r.action || 'Auth change', detail: [r.entityName, r.entityId].filter(Boolean).join(' · ') || 'IAM event', tone: 'info' as const }));
    const evts = activityEvents.map((r) => ({ id: `s:${r.id}`, createdAt: r.createdAt, title: r.eventType || r.action || 'Security event', detail: r.description || [r.ipAddress, r.userAgent].filter(Boolean).join(' · ') || 'Security signal', tone: 'warning' as const }));
    return [...logs, ...evts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [activityEvents, activityLogs]);

  /* ── Overview metrics ── */
  const overviewMetrics = useMemo(() => {
    const active = users.filter((u) => String(u.status || '').toLowerCase() === 'active').length;
    const inactive = users.filter((u) => String(u.status || '').toLowerCase() !== 'active').length;
    const locked = users.filter((u) => ['locked', 'suspended'].includes(String(u.status || '').toLowerCase())).length;
    const recent = auditSorted.filter((r) => { if (!r.createdAt) return false; const ms = Date.now() - new Date(r.createdAt).getTime(); return ms >= 0 && ms <= 7 * 86400000; }).length;
    return [
      { label: 'Active Users', value: active, click: () => setView('users') },
      { label: 'Inactive Users', value: inactive, click: () => { usersQuery.setFilter('status', 'locked'); setView('users'); } },
      { label: 'Locked Accounts', value: locked, click: () => { usersQuery.setFilter('status', 'locked'); setView('users'); } },
      { label: 'Recent Changes (7d)', value: recent, click: () => setView('audit') },
    ];
  }, [auditSorted, users, usersQuery]);

  const roleDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    [...dirMeta.values()].forEach((m) => counts.set(m.primaryRoleCode || 'none', (counts.get(m.primaryRoleCode || 'none') ?? 0) + 1));
    const total = Math.max(1, [...counts.values()].reduce((s, v) => s + v, 0));
    return [...counts.entries()].map(([code, count]) => ({
      code, label: roleRefs.find((r) => r.code === code)?.name || (code === 'none' ? 'No role' : code),
      count, pct: (count / total) * 100,
      tone: (roleRefs.find((r) => r.code === code)?.tone || 'neutral') as IamTone,
    })).sort((a, b) => b.count - a.count);
  }, [dirMeta, roleRefs]);

  const overviewAlerts = useMemo(() => {
    const noRole = users.filter((u) => !dirMeta.has(u.id)).length;
    const superadmins = new Set(collapsed.filter((a) => a.canonicalRole === 'superadmin').map((a) => a.userId)).size;
    const compat = [...dirMeta.values()].filter((m) => m.compatibilityOnlyLabels.length > 0).length;
    return [
      { label: 'Users without roles', value: noRole, danger: noRole > 0, click: () => setView('users') },
      { label: 'Superadmin users', value: superadmins, danger: superadmins > 3, click: () => { setUserRoleFilter('superadmin'); setView('users'); } },
      { label: 'Compatibility-only', value: compat, danger: compat > 0, click: () => { setLegacyOnly(true); setView('users'); } },
      { label: 'Sensitive grants', value: sensitiveOverrides.length, danger: sensitiveOverrides.length > 0, click: () => { setAuditTab('sensitive'); setView('audit'); } },
    ];
  }, [collapsed, dirMeta, sensitiveOverrides.length, users]);

  /* ── Actions ── */
  const refresh = () => {
    const map: Record<IamView, () => void> = {
      overview: () => { void loadUsers(); void loadScopes(); void loadOverrides(); void loadAudit(); },
      users: () => { void loadUsers(); void loadScopes(); void loadOverrides(); },
      assignments: () => void loadScopes(),
      roles: () => void loadRoles(),
      permissions: () => { void loadPermCatalog(); void loadOverrides(); },
      'effective-access': () => { void loadScopes(); void loadOverrides(); },
      audit: () => { void loadAudit(); void loadSecEvents(); },
      security: () => void loadSessions(),
    };
    map[view]?.();
  };

  const submitAssignment = async () => {
    if (!token) return;
    if (!assignForm.username.trim() || !assignForm.password || !assignForm.fullName.trim()) {
      toast.error('Username, password, and full name are required'); return;
    }
    const body: Parameters<typeof authApi.createUser>[1] = {
      username: assignForm.username.trim(), password: assignForm.password,
      fullName: assignForm.fullName.trim(),
      employeeCode: assignForm.employeeCode.trim() || null,
      email: assignForm.email.trim() || null,
    };
    if (assignForm.roleCode && canManageRoles) {
      if (assignMode === 'outlet') {
        if (!assignForm.outletId) { toast.error('Select an outlet'); return; }
        body.outletAccess = [{ outletId: assignForm.outletId, roles: [assignForm.roleCode] }];
      } else {
        if (!assignForm.regionId) { toast.error('Select a region'); return; }
        body.scopeAssignments = [{ scopeType: 'region', scopeId: assignForm.regionId, roles: [assignForm.roleCode] }];
      }
    }
    setCreatingUser(true);
    try {
      await authApi.createUser(token, body);
      toast.success('User created');
      setAssignSheetOpen(false);
      setAssignForm({ username: '', password: '', fullName: '', employeeCode: '', email: '', roleCode: '', outletId: scopedOutletId || '', regionId: '' });
      void loadUsers(); void loadScopes(); void loadOverrides();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to create user')); }
    finally { setCreatingUser(false); }
  };

  const doAssignRole = async () => {
    if (!token || !assignRoleUserId || !assignRoleCode || !assignRoleOutletId) {
      toast.error('Please select a role and outlet');
      return;
    }
    setAssignRoleBusy(true);
    try {
      await authApi.assignRole(token, assignRoleUserId, assignRoleOutletId, assignRoleCode);
      toast.success(`Role ${assignRoleCode} assigned successfully`);
      setAssignRoleOpen(false);
      void loadScopes(); void loadOverrides(); void loadUsers();
    } catch (e: unknown) {
      console.error('Assign role failed:', e);
      toast.error(getErrorMessage(e, 'Unable to assign role'));
    } finally { setAssignRoleBusy(false); }
  };

  const doRevokeRole = async (userId: string, outletId: string, roleCode: string) => {
    if (!token) return;
    try {
      await authApi.revokeRole(token, userId, outletId, roleCode);
      toast.success('Role revoked');
      void loadScopes(); void loadOverrides();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to revoke role')); }
  };

  const doGrantPermission = async () => {
    if (!token || !grantPermUserId || !grantPermCode || !grantPermOutletId) {
      toast.error('Please select a permission and outlet');
      return;
    }
    setGrantPermBusy(true);
    try {
      await authApi.grantPermission(token, grantPermUserId, grantPermOutletId, grantPermCode);
      toast.success(`Permission ${grantPermCode} granted successfully`);
      setGrantPermOpen(false);
      void loadOverrides(); void loadScopes();
    } catch (e: unknown) {
      console.error('Grant permission failed:', e);
      toast.error(getErrorMessage(e, 'Unable to grant permission'));
    } finally { setGrantPermBusy(false); }
  };

  const doRevokePermission = async (userId: string, outletId: string, permissionCode: string) => {
    if (!token) return;
    try {
      await authApi.revokePermission(token, userId, outletId, permissionCode);
      toast.success('Permission revoked');
      void loadOverrides();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to revoke permission')); }
  };

  const doUpdateUserStatus = async (userId: string, status: string) => {
    if (!token) return;
    try {
      await authApi.updateUserStatus(token, userId, status);
      toast.success(`User ${status}`);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
      void loadUsers();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to update user status')); }
  };

  const previewRows = useMemo(
    () => assignMode === 'region' && assignForm.regionId && assignForm.roleCode
      ? buildFanOutPreview(null, assignForm.roleCode, assignForm.regionId, collapsed, outlets)
      : [],
    [assignForm.regionId, assignForm.roleCode, assignMode, collapsed, outlets],
  );

  const doRevokeRoleConfirmed = async () => {
    if (!token || !revokeRoleTarget) return;
    try {
      const { userId, outletId, roleCode } = revokeRoleTarget;
      await authApi.revokeRole(token, userId, outletId, roleCode);
      toast.success('Role revoked');
      setRevokeRoleTarget(null);
      void loadScopes(); void loadUsers();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to revoke role')); }
  };

  const doRevokePermissionConfirmed = async () => {
    if (!token || !revokePermTarget) return;
    try {
      const { userId, outletId, permissionCode } = revokePermTarget;
      await authApi.revokePermission(token, userId, outletId, permissionCode);
      toast.success('Permission revoked');
      setRevokePermTarget(null);
      void loadOverrides(); void loadScopes();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to revoke permission')); }
  };

  const doSaveRolePermissions = async () => {
    if (!token || !rolePermCode) return;
    setRolePermBusy(true);
    try {
      await authApi.replaceRolePermissions(token, rolePermCode, [...selectedPerms]);
      toast.success(`Permissions updated for ${rolePermCode}`);
      setRolePermOpen(false);
      void loadRoles();
    } catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to update permissions')); }
    finally { setRolePermBusy(false); }
  };

  /* ── Guard ── */
  if (!token) return <ServiceUnavailablePage state="service_unavailable" moduleName="IAM" />;

  const currentNav = navItems.find((n) => n.key === view) || NAV_ITEMS[0];

  /* ════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════ */
  return (
    <div className="flex h-full animate-fade-in">
      {/* ── Sidebar ── */}
      <nav className="hidden w-52 shrink-0 flex-col border-r border-border bg-muted/20 lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">IAM</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {navItems.map((n) => (
            <button key={n.key} type="button" onClick={() => setView(n.key)}
              className={cn('flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors',
                view === n.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground')}>
              <n.icon className="h-4 w-4 shrink-0" />{n.label}
            </button>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
            <div className="rounded-md bg-background px-2 py-1.5"><p className="font-medium">{usersTotal || users.length}</p><p className="text-muted-foreground">Users</p></div>
            <div className="rounded-md bg-background px-2 py-1.5"><p className="font-medium">{overrides.length}</p><p className="text-muted-foreground">Grants</p></div>
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border bg-background px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">IAM</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="font-medium">{currentNav.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile nav */}
            <div className="flex items-center gap-0.5 lg:hidden">
              {navItems.map((n) => (
                <button key={n.key} type="button" onClick={() => setView(n.key)}
                  className={cn('rounded px-2 py-1 text-xs', view === n.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground')}>
                  {n.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={refresh}>
              <RefreshCw className="h-3 w-3" />Refresh
            </Button>
            {canManageUsers ? (
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setAssignSheetOpen(true)}>
                <UserPlus className="h-3 w-3" />Invite User
              </Button>
            ) : null}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] space-y-4 px-5 py-4">
            {governanceBanner ? <PermissionBanner state="read_only" moduleName="IAM" detail={governanceBanner} /> : null}

  {/* ═══════ OVERVIEW ═══════ */}
  {view === 'overview' ? (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overviewMetrics.map((m) => (
          <button key={m.label} type="button" onClick={m.click} className="rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/30">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-background">
            <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Role Distribution</h3></div>
            <div className="p-4 space-y-2">
              {roleDistribution.length === 0 ? <EmptyState title="No users" description="Invite your first user." /> : roleDistribution.map((r) => (
                <button key={r.code} type="button" onClick={() => { setUserRoleFilter(r.code === 'none' ? 'all' : r.code); setView('users'); }} className="flex w-full items-center gap-3 rounded px-2 py-1 hover:bg-muted/30">
                  <span className="w-28 truncate text-sm">{r.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn('h-full rounded-full', r.tone === 'danger' ? 'bg-red-500' : r.tone === 'warning' ? 'bg-amber-500' : r.tone === 'success' ? 'bg-emerald-500' : r.tone === 'info' ? 'bg-blue-500' : 'bg-slate-400')} style={{ width: `${r.pct}%` }} />
                  </div>
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{r.count}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Recent Changes</h3>
              <button type="button" onClick={() => setView('audit')} className="text-xs text-primary hover:underline">View all</button>
            </div>
            <div className="divide-y divide-border">
              {auditLoading ? <div className="p-4"><table className="w-full"><tbody><ListTableSkeleton columns={1} rows={4} /></tbody></table></div>
              : auditSorted.length === 0 ? <div className="p-4"><EmptyState title="No activity" description="No auth audit rows yet." /></div>
              : auditSorted.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{r.action || 'Auth change'}</p>
                    <p className="truncate text-xs text-muted-foreground">{[r.entityName, r.entityId].filter(Boolean).join(' · ') || 'IAM event'}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-background">
            <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Attention Needed</h3></div>
            <div className="divide-y divide-border">
              {overviewAlerts.map((a) => (
                <button key={a.label} type="button" onClick={a.click} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/20">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', a.danger ? 'bg-amber-500' : 'bg-slate-300')} />
                    <span className="text-sm">{a.label}</span>
                  </div>
                  <span className="font-medium tabular-nums">{a.value}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-border bg-background p-4 space-y-2">
            <h3 className="text-sm font-semibold">Quick Actions</h3>
            <Button className="w-full justify-start gap-2" size="sm" onClick={() => setAssignSheetOpen(true)} disabled={!canManageUsers}><UserPlus className="h-3.5 w-3.5" />Invite User</Button>
            <Button variant="outline" className="w-full justify-start gap-2" size="sm" onClick={() => setView('effective-access')}><Eye className="h-3.5 w-3.5" />Effective Access</Button>
          </section>
        </aside>
      </div>
    </div>
  ) : null}

  {/* ═══════ USERS ═══════ */}
  {view === 'users' ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 w-60 pl-8 text-sm" placeholder="Search..." value={usersQuery.searchInput} onChange={(e) => usersQuery.setSearchInput(e.target.value)} />
        </div>
        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={userRoleFilter} onChange={(e) => { setUserRoleFilter(e.target.value); usersQuery.setFilter('roleCode', e.target.value === 'all' ? undefined : e.target.value); }}>
          <option value="all">All roles</option>
          {roleRefs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={userScopeFilter} onChange={(e) => setUserScopeFilter(e.target.value as 'all' | IamScopeType)}>
          <option value="all">All scopes</option>
          <option value="global">Global</option><option value="region">Region</option><option value="outlet">Outlet</option>
        </select>
        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={userRegionFilter} onChange={(e) => { setUserRegionFilter(e.target.value); usersQuery.setFilter('regionId', e.target.value === 'all' ? undefined : e.target.value); }}>
          <option value="all">All regions</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {[{ l: 'All', v: 'all' }, { l: 'Invited', v: 'invited' }, { l: 'Locked', v: 'locked' }].map((i) => (
          <button key={i.v} type="button" onClick={() => usersQuery.setFilter('status', i.v === 'all' ? undefined : i.v)}
            className={cn('rounded-md border px-2 py-1 text-xs', (usersQuery.filters.status || 'all') === i.v ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted/30')}>
            {i.l}
          </button>
        ))}
        <button type="button" onClick={() => setLegacyOnly((c) => !c)} className={cn('rounded-md border px-2 py-1 text-xs', legacyOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-input text-muted-foreground')}>Legacy</button>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {scopesLoading ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading roles...</> : null}
          {filteredUsers.length} of {usersTotal}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last Seen</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usersLoading ? <ListTableSkeleton columns={7} rows={8} />
              : filteredUsers.length === 0 ? <tr><td colSpan={7} className="p-6"><EmptyState title="No users" description="Try clearing filters." /></td></tr>
              : filteredUsers.map((u) => {
                const meta = dirMeta.get(u.id);
                return (
                  <tr key={u.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => { setSelectedUserId(u.id); setDetailTab('assignments'); setUserDetailOpen(true); }}>
                    <td className="px-3 py-2"><div className="font-medium">{u.fullName || u.username}</div><div className="text-xs text-muted-foreground">{u.username}</div></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{u.email || '—'}</td>
                    <td className="px-3 py-2 text-xs">{meta?.primaryRoleLabel || '—'}{meta && meta.additionalRoleCount > 0 ? <span className="text-muted-foreground"> +{meta.additionalRoleCount}</span> : null}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{meta?.scopeSummary || '—'}</td>
                    <td className="px-3 py-2"><StatusDot status={u.status || 'unknown'} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatRelativeTime(userDateField(u, ['lastLoginAt', 'lastSeenAt', 'updatedAt']))}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => { setSelectedUserId(u.id); setView('effective-access'); }}>Effective Access</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {canManageRoles ? <DropdownMenuItem onClick={() => { setAssignRoleUserId(u.id); setAssignRoleUserName(u.fullName || u.username); setAssignRoleCode(''); setAssignRoleOutletId(scopedOutletId || ''); setAssignRoleOpen(true); }}>Assign Role</DropdownMenuItem> : null}
                          {canManageUsers ? <DropdownMenuItem onClick={() => void doUpdateUserStatus(u.id, String(u.status || '').toLowerCase() === 'locked' ? 'active' : 'locked')}>
                            {String(u.status || '').toLowerCase() === 'locked' ? 'Unlock' : 'Lock'}
                          </DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ListPaginationControls total={usersTotal} limit={usersQuery.limit} offset={usersQuery.offset} hasMore={usersHasMore} disabled={usersLoading} onPageChange={usersQuery.setPage} onLimitChange={usersQuery.setPageSize} />
    </div>
  ) : null}

  {/* ═══════ ASSIGNMENTS ═══════ */}
  {view === 'assignments' ? (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <section className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Assignment Studio</h3>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setAssignSheetOpen(true)}><UserPlus className="h-3 w-3" />Invite</Button>
        </div>
        <p className="text-xs text-muted-foreground">Create new users or assign roles to existing users.</p>

        <Separator className="my-3" />
        <h4 className="text-xs font-medium">Assign to Existing User</h4>
        <div className="mt-2 space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground">User</label>
            <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={assignRoleUserId} onChange={(e) => { setAssignRoleUserId(e.target.value); const u = users.find((x) => x.id === e.target.value); setAssignRoleUserName(u?.fullName || u?.username || ''); }}>
              <option value="">Select user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.username}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Role</label>
            <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={assignRoleCode} onChange={(e) => setAssignRoleCode(e.target.value)}>
              <option value="">Select role</option>
              {roleRefs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Outlet</label>
            <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={assignRoleOutletId} onChange={(e) => setAssignRoleOutletId(e.target.value)}>
              <option value="">Select outlet</option>
              {outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
            </select>
          </div>
          <Button size="sm" className="h-7 w-full text-xs" disabled={!assignRoleUserId || !assignRoleCode || !assignRoleOutletId || assignRoleBusy} onClick={() => void doAssignRole()}>
            {assignRoleBusy ? 'Assigning...' : 'Assign Role'}
          </Button>
        </div>

        <Separator className="my-3" />
        <h4 className="text-xs font-medium">New User</h4>
        <div className="mt-2 space-y-2">
          <button type="button" onClick={() => { setAssignMode('outlet'); setAssignSheetOpen(true); }} className="w-full rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40 transition-colors"><p className="text-xs font-medium">By Outlet</p><p className="mt-0.5 text-xs text-muted-foreground">One role, one outlet.</p></button>
          <button type="button" onClick={() => { setAssignMode('region'); setAssignSheetOpen(true); }} className="w-full rounded-md border border-border bg-muted/20 p-3 text-left hover:bg-muted/40 transition-colors"><p className="text-xs font-medium">By Region</p><p className="mt-0.5 text-xs text-muted-foreground">Fan-out to all outlets in region.</p></button>
        </div>
      </section>
      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 gap-2">
          <h3 className="text-sm font-semibold shrink-0">Current Assignments ({filteredCollapsed.length}/{collapsed.length})</h3>
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 w-44 pl-7 text-xs"
                placeholder="Search user / role..."
                value={assignSearch}
                onChange={(e) => { setAssignSearch(e.target.value); setAssignPage(0); }}
              />
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground shrink-0" onClick={() => void loadScopes()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Outlets</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {scopesLoading ? <ListTableSkeleton columns={6} rows={6} />
              : pagedCollapsed.length === 0 ? <tr><td colSpan={6} className="p-6"><EmptyState title="No assignments" description={assignSearch ? 'No results — try clearing search.' : 'Invite a user to create assignments.'} /></td></tr>
              : pagedCollapsed.map((a) => {
                const rr = roleRefs.find((r) => r.code === a.canonicalRole);
                return (
                  <tr key={a.key}>
                    <td className="px-3 py-2"><div className="text-xs font-medium">{a.fullName || a.username}</div><div className="text-[10px] text-muted-foreground">{a.username}</div></td>
                    <td className="px-3 py-2"><StatusDot status={a.userStatus || 'unknown'} /></td>
                    <td className="px-3 py-2"><RoleBadge label={rr?.name || a.canonicalRole} tone={rr?.tone || 'neutral'} /></td>
                    <td className="px-3 py-2"><ScopePill scopeType={a.scopeType} label={summarizeScope(a)} /></td>
                    <td className="px-3 py-2"><SourceBadge sourceType={a.sourceType} label={a.sourceType === 'legacy' ? `Legacy: ${a.legacyCode}` : 'Canonical'} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{a.outletCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-3 py-2">
          <ListPaginationControls
            total={filteredCollapsed.length}
            limit={assignPageSize}
            offset={assignPage * assignPageSize}
            hasMore={(assignPage + 1) * assignPageSize < filteredCollapsed.length}
            disabled={scopesLoading}
            onPageChange={(p) => setAssignPage(p - 1)}
            onLimitChange={() => { /* fixed page size */ }}
          />
        </div>
      </section>
    </div>
  ) : null}

  {/* ═══════ ROLES ═══════ */}
  {view === 'roles' ? (
    <Tabs value={roleTab} onValueChange={(v) => setRoleTab(v as RoleWorkspaceTab)}>
      <TabsList className="mb-4"><TabsTrigger value="canonical">Canonical Roles</TabsTrigger><TabsTrigger value="legacy">Legacy Mapping</TabsTrigger><TabsTrigger value="compare">Compare</TabsTrigger></TabsList>

      <TabsContent value="canonical">
        <div className="grid gap-3 xl:grid-cols-2">
          {rolesLoading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-lg border border-border bg-muted/20" />)
          : roleRefs.map((r) => (
            <div key={r.code} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{r.name}</h4>
                {r.badge ? <RoleBadge label={r.badge} tone={r.tone} /> : null}
                <ScopePill scopeType={r.scopeType} label={r.scopeType} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{r.purpose}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><p className="text-[10px] uppercase text-muted-foreground">Capabilities</p><ul className="mt-1 space-y-0.5 text-xs">{r.capabilities.map((c) => <li key={c}>{c}</li>)}</ul></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Limits</p><ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{r.limits.map((l) => <li key={l}>{l}</li>)}</ul></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => { setUserRoleFilter(r.code); setView('users'); }}>View Users</Button>
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => { setCompareRoleCodes((c) => [...new Set([r.code, ...c])].slice(0, 3)); setRoleTab('compare'); }}>Compare</Button>
                {canManageRoles ? (
                  <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => { setRolePermCode(r.code); setSelectedPerms(new Set()); setRolePermOpen(true); }}>Manage Permissions</Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="legacy">
        <div className="rounded-lg border border-border bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Legacy Code</th><th className="px-3 py-2 font-medium">Canonical</th><th className="px-3 py-2 font-medium">Users</th><th className="px-3 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {legacyRows.map((r) => (
                <tr key={r.legacyCode}>
                  <td className="px-3 py-2 text-xs font-medium">{r.legacyCode}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.canonicalLabel || '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.affectedUserCount}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={cn('text-[10px]', r.status === 'mapped' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-amber-300 bg-amber-50 text-amber-700')}>{r.status === 'mapped' ? 'Mapped' : 'Compat only'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="compare">
        <div className="space-y-4">
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <select key={i} className="h-8 min-w-48 rounded-md border border-input bg-background px-2 text-xs" value={compareRoleCodes[i] || ''} onChange={(e) => { const n = [...compareRoleCodes]; n[i] = e.target.value; setCompareRoleCodes(n.filter(Boolean)); }}>
                <option value="">Select role</option>
                {roleRefs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-background overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Capability</th>
                {compareRoleCodes.map((c) => <th key={c} className="px-3 py-2 font-medium">{roleRefs.find((r) => r.code === c)?.name || c}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {roleComparison.rows.map((row) => (
                  <tr key={row.id} className={row.differs ? 'bg-amber-50/30' : ''}>
                    <td className="px-3 py-2"><span className="text-xs font-medium">{row.capability}</span><br /><span className="text-[10px] text-muted-foreground">{row.domain}</span></td>
                    {row.cells.map((c) => (
                      <td key={`${row.id}:${c.roleCode}`} className="px-3 py-2">
                        <Badge variant="outline" className={cn('text-[10px]', c.allowed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600')}>
                          {c.marker === '—' ? '—' : `${c.marker} (${c.scopeType})`}
                        </Badge>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {roleComparison.summary.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Key Differences</p>
              <ul className="space-y-1 text-xs">{roleComparison.summary.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          ) : null}
        </div>
      </TabsContent>
    </Tabs>
  ) : null}

  {/* ═══════ PERMISSIONS ═══════ */}
  {view === 'permissions' ? (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Permission Catalog</h3><p className="text-xs text-muted-foreground">8 fallback grants. Role-first, permission-second.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Permission</th><th className="px-3 py-2 font-medium">Meaning</th><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {permCatalogLoading ? <ListTableSkeleton columns={4} rows={8} /> : permRefs.map((p) => (
                <tr key={p.code}>
                  <td className="px-3 py-2"><div className="text-xs font-medium">{p.label}</div><div className="text-[10px] text-muted-foreground">{p.code}</div></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.businessMeaning}</td>
                  <td className="px-3 py-2 text-xs">{p.scope}</td>
                  <td className="px-3 py-2">{p.sensitive ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700">Sensitive</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <h3 className="text-sm font-semibold">Active Grants</h3>
            {canManageRoles ? (
              <Button size="sm" className="h-6 gap-1 text-[10px]" onClick={() => { setGrantPermUserId(''); setGrantPermCode(''); setGrantPermOutletId(''); setGrantPermOpen(true); }}>
                <UserPlus className="h-3 w-3" />Grant
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" /><Input className="h-7 w-36 pl-7 text-xs" placeholder="Search..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} /></div>
            <select className="h-7 rounded-md border border-input bg-background px-2 text-xs" value={permFilter} onChange={(e) => setPermFilter(e.target.value)}>
              <option value="all">All</option>
              {permRefs.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Permission</th><th className="px-3 py-2 font-medium">Outlet</th><th className="px-3 py-2 font-medium">Granted</th></tr></thead>
            <tbody className="divide-y divide-border">
              {overridesLoading ? <ListTableSkeleton columns={4} rows={5} />
              : filteredOverrides.length === 0 ? <tr><td colSpan={4} className="p-6"><EmptyState title="No grants" description="No matching permission grants." /></td></tr>
              : filteredOverrides.map((r, i) => (
                <tr key={`${r.userId}:${r.outletId}:${r.permissionCode}:${i}`}>
                  <td className="px-3 py-2"><div className="text-xs font-medium">{r.fullName || r.username}</div></td>
                  <td className="px-3 py-2 text-xs">{r.permissionName || r.permissionCode}{IAM_SENSITIVE_PERMISSION_CODES.has(r.permissionCode) ? <Badge variant="outline" className="ml-1 border-amber-300 bg-amber-50 text-[10px] text-amber-700">!</Badge> : null}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.outletName || r.outletCode || r.outletId}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(r.assignedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  ) : null}

  {/* ═══════ EFFECTIVE ACCESS ═══════ */}
  {view === 'effective-access' ? (
    <Tabs value={accessTab} onValueChange={(v) => setAccessTab(v as AccessWorkspaceTab)}>
      <TabsList className="mb-4"><TabsTrigger value="by-user">By User</TabsTrigger><TabsTrigger value="by-outlet">By Outlet</TabsTrigger></TabsList>

      <TabsContent value="by-user">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-sm" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            <option value="">Select user</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.username}</option>)}
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={accessDomainFilter} onChange={(e) => setAccessDomainFilter(e.target.value)}>
            <option value="all">All domains</option>
            {Array.from(new Set(selectedUserAccess.map((r) => r.domain))).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={accessEffectFilter} onChange={(e) => setAccessEffectFilter(e.target.value as 'all' | 'allow' | 'deny')}>
            <option value="all">Allow + Deny</option><option value="allow">Allow</option><option value="deny">Deny</option>
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={accessSourceFilter} onChange={(e) => setAccessSourceFilter(e.target.value as 'all' | IamSourceType)}>
            <option value="all">All sources</option><option value="canonical">Role</option><option value="permission">Permission</option><option value="read_floor">Read floor</option><option value="legacy">Legacy</option><option value="denied">Denied</option>
          </select>
        </div>
        {!selectedUser ? <EmptyState title="Select a user" description="Pick a user to view their effective access." />
        : Object.keys(effectiveByDomain).length === 0 ? <EmptyState title="No access rows" description="Filters removed all rows." />
        : Object.entries(effectiveByDomain).map(([domain, rows]) => (
          <div key={domain} className="mb-4 rounded-lg border border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between bg-muted/30 px-4 py-2"><h4 className="text-xs font-semibold">{domain}</h4><span className="text-[10px] text-muted-foreground">{rows.length} rows</span></div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 w-40"><span className="text-xs font-medium">{r.capability}</span>{r.sensitive ? <Badge variant="outline" className="ml-1 border-amber-300 bg-amber-50 text-[10px] text-amber-700">!</Badge> : null}</td>
                    <td className="px-3 py-2 w-20"><EffectBadge effect={r.effect} /></td>
                    <td className="px-3 py-2 w-40"><ScopePill scopeType={r.scopeType} label={r.scopeLabel} /></td>
                    <td className="px-3 py-2 w-36"><SourceBadge sourceType={r.sourceType} label={r.sourceLabel} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="by-outlet">
        <div className="mb-4">
          <select className="h-8 min-w-56 rounded-md border border-input bg-background px-2 text-sm" value={selectedOutletAccessId} onChange={(e) => setSelectedOutletAccessId(e.target.value)}>
            <option value="">Select outlet</option>
            {outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
        </div>
        <div className="rounded-lg border border-border bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Roles</th><th className="px-3 py-2 font-medium">Access</th><th className="px-3 py-2 font-medium">Source</th></tr></thead>
            <tbody className="divide-y divide-border">
              {outletAccessRows.length === 0 ? <tr><td colSpan={4} className="p-6"><EmptyState title="No users" description="Select an outlet with members." /></td></tr>
              : outletAccessRows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2"><div className="text-xs font-medium">{r.fullName}</div><div className="text-[10px] text-muted-foreground">{r.username}</div></td>
                  <td className="px-3 py-2 space-x-1">{r.roleLabels.map((l) => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}</td>
                  <td className="px-3 py-2 space-x-1">{r.domainAccessSummary.length > 0 ? r.domainAccessSummary.map((s) => <Badge key={s} variant="outline" className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700">{s}</Badge>) : <span className="text-[10px] text-muted-foreground">Read floor</span>}</td>
                  <td className="px-3 py-2 space-x-1">{r.sourceTypes.map((s) => <SourceBadge key={s} sourceType={s} label={s === 'canonical' ? 'Role' : s === 'legacy' ? 'Legacy' : s === 'permission' ? 'Perm' : 'Floor'} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>
    </Tabs>
  ) : null}

  {/* ═══════ AUDIT ═══════ */}
  {view === 'audit' ? (
    <Tabs value={auditTab} onValueChange={(v) => setAuditTab(v as AuditWorkspaceTab)}>
      <TabsList className="mb-4"><TabsTrigger value="changes">Change Log</TabsTrigger><TabsTrigger value="sensitive">Sensitive</TabsTrigger><TabsTrigger value="login-mfa">Login / MFA</TabsTrigger></TabsList>

      <TabsContent value="changes">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" /><Input className="h-7 w-56 pl-7 text-xs" placeholder="Search..." value={auditQuery.searchInput} onChange={(e) => auditQuery.setSearchInput(e.target.value)} /></div>
          <select className="h-7 rounded-md border border-input bg-background px-2 text-xs" value={auditQuery.sortDir} onChange={(e) => auditQuery.applySort('createdAt', e.target.value === 'asc' ? 'asc' : 'desc')}>
            <option value="desc">Newest first</option><option value="asc">Oldest first</option>
          </select>
        </div>
        <div className="rounded-lg border border-border bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Actor</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Target</th><th className="px-3 py-2 font-medium">Detail</th></tr></thead>
            <tbody className="divide-y divide-border">
              {auditLoading ? <ListTableSkeleton columns={5} rows={6} />
              : auditSorted.length === 0 ? <tr><td colSpan={5} className="p-6"><EmptyState title="No audit rows" description="No auth change-log rows." /></td></tr>
              : auditSorted.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{r.actorUserId ? (userIdToUsername.get(r.actorUserId) || r.actorUserId) : '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.action || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{[r.entityName, r.entityId].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{String(r.module || 'auth')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><ListPaginationControls total={auditTotal} limit={auditQuery.limit} offset={auditQuery.offset} hasMore={auditHasMore} disabled={auditLoading} onPageChange={auditQuery.setPage} onLimitChange={auditQuery.setPageSize} /></div>
      </TabsContent>

      <TabsContent value="sensitive">
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5"><h4 className="text-sm font-semibold">Active Sensitive Grants</h4><span className="text-xs text-muted-foreground">{sensitiveOverrides.length}</span></div>
            <div className="divide-y divide-border">
              {sensitiveOverrides.length === 0 ? <div className="p-4"><EmptyState title="None" description="No sensitive grants." /></div>
              : sensitiveOverrides.map((r, i) => (
                <div key={`${r.userId}:${r.permissionCode}:${i}`} className="px-4 py-2.5">
                  <div className="flex items-center justify-between"><span className="text-xs font-medium">{r.permissionCode}</span><Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700">Sensitive</Badge></div>
                  <p className="text-xs text-muted-foreground">{r.fullName || r.username} · {r.outletName || r.outletId}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5"><h4 className="text-sm font-semibold">Matching Audit Rows</h4><span className="text-xs text-muted-foreground">{sensitiveAudit.length}</span></div>
            <div className="divide-y divide-border">
              {sensitiveAudit.length === 0 ? <div className="p-4"><EmptyState title="None" description="No sensitive audit matches." /></div>
              : sensitiveAudit.slice(0, 10).map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                  <div><p className="text-xs font-medium">{r.action || 'Auth change'}</p><p className="text-[10px] text-muted-foreground">{[r.entityName, r.entityId].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-[10px] text-muted-foreground">{formatRelativeTime(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </TabsContent>

      <TabsContent value="login-mfa">
        <div className="rounded-lg border border-border bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Event</th><th className="px-3 py-2 font-medium">Severity</th><th className="px-3 py-2 font-medium">Actor</th><th className="px-3 py-2 font-medium">Detail</th></tr></thead>
            <tbody className="divide-y divide-border">
              {secLoading ? <ListTableSkeleton columns={5} rows={5} />
              : loginEvents.length === 0 ? <tr><td colSpan={5} className="p-6"><EmptyState title="No events" description="No login/MFA events." /></td></tr>
              : loginEvents.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{r.eventType || r.action || 'Event'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.severity || '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.actorUserId ? (userIdToUsername.get(r.actorUserId) || r.actorUserId) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.description || [r.ipAddress, r.userAgent].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>
    </Tabs>
  ) : null}

  {/* ═══════ SECURITY ═══════ */}
  {view === 'security' ? (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Active Sessions</h3>
          <span className="text-xs text-muted-foreground">{sessions.length}</span>
        </div>
        <div className="divide-y divide-border">
          {sessionsLoading ? <div className="p-4"><table className="w-full"><tbody><ListTableSkeleton columns={1} rows={4} /></tbody></table></div>
          : sessions.length === 0 ? <div className="p-4"><EmptyState title="No sessions" description="No sessions returned." /></div>
          : sessions.map((r) => (
            <div key={r.sessionId} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{r.current ? 'Current Session' : r.sessionId}</span>
                  <StatusDot status={r.state || 'active'} />
                  {r.current ? <Badge variant="outline" className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">Current</Badge> : null}
                </div>
                <p className="truncate text-[10px] text-muted-foreground">{r.userAgent || 'Unknown'} {r.clientIp ? `· ${r.clientIp}` : ''}</p>
                <p className="text-[10px] text-muted-foreground">Issued {formatDateTime(r.issuedAt)} · Expires {formatDateTime(r.expiresAt)}</p>
              </div>
              {!r.current && r.state !== 'revoked' ? <Button variant="outline" size="sm" className="h-6 shrink-0 text-[10px]" onClick={() => setSessionToRevoke(r)}>Revoke</Button> : null}
            </div>
          ))}
        </div>
      </section>
      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Security Policies</h3><p className="text-xs text-muted-foreground">Pending backend routes.</p></div>
          <div className="divide-y divide-border">
            {['MFA Configuration', 'Session Policies', 'PIN / Passcode (POS)', 'Service Accounts'].map((t) => (
              <div key={t} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs">{t}</span>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">Pending</Badge>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-2.5"><h3 className="text-sm font-semibold">Recent Security Events</h3></div>
          <div className="divide-y divide-border">
            {secLoading ? <div className="p-4"><table className="w-full"><tbody><ListTableSkeleton columns={1} rows={3} /></tbody></table></div>
            : secEvents.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2">
                <div className="min-w-0"><p className="truncate text-xs">{r.eventType || r.action || 'Event'}</p><p className="truncate text-[10px] text-muted-foreground">{r.description || '—'}</p></div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  ) : null}

          </div>{/* end max-w */}
        </div>{/* end overflow */}
      </div>{/* end main */}

      {/* ═══════ USER DETAIL DRAWER ═══════ */}
      <Sheet open={userDetailOpen && Boolean(selectedUser)} onOpenChange={(o) => { if (!o) setUserDetailOpen(false); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedUser ? (
            <div className="space-y-5">
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10"><AvatarFallback className="text-xs">{initials(selectedUser.fullName)}</AvatarFallback></Avatar>
                  <div>
                    <SheetTitle className="text-base">{selectedUser.fullName || selectedUser.username}</SheetTitle>
                    <SheetDescription className="text-xs">{selectedUser.email || selectedUser.username} · <StatusDot status={selectedUser.status || 'unknown'} /></SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              {selectedUserAssignments.length === 0 ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">No role assignments — access limited to read floor.</div> : null}
              {dirMeta.get(selectedUser.id)?.hasSuperadmin ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">Superadmin — all restrictions bypassed.</div> : null}

              <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as DetailTab)}>
                <TabsList>{DETAIL_TABS.map((t) => <TabsTrigger key={t.key} value={t.key} className="text-xs">{t.label}</TabsTrigger>)}</TabsList>

                <TabsContent value="assignments" className="mt-3">
                  {canManageRoles ? (
                    <div className="mb-3 flex justify-end">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setAssignRoleUserId(selectedUser.id); setAssignRoleUserName(selectedUser.fullName || selectedUser.username); setAssignRoleCode(''); setAssignRoleOutletId(''); setAssignRoleOpen(true); }}>Assign Role</Button>
                    </div>
                  ) : null}
                  {selectedUserAssignments.length === 0 ? <EmptyState title="No roles" description="No collapsed assignments." />
                  : <table className="w-full text-sm"><tbody className="divide-y divide-border">
                    {selectedUserAssignments.map((a) => {
                      const rr = roleRefs.find((r) => r.code === a.canonicalRole);
                      return (
                        <tr key={a.key}>
                          <td className="py-2 pr-2"><RoleBadge label={rr?.name || a.canonicalRole} tone={rr?.tone || 'neutral'} />{rr?.badge ? <RoleBadge label={rr.badge} tone={rr.tone} /> : null}</td>
                          <td className="py-2 pr-2"><ScopePill scopeType={a.scopeType} label={summarizeScope(a)} /></td>
                          <td className="py-2 pr-2"><SourceBadge sourceType={a.sourceType} label={a.sourceType === 'legacy' ? `Legacy: ${a.legacyCode}` : 'Canonical'} /></td>
                          <td className="py-2 text-xs text-muted-foreground">{a.outletCount}</td>
                          {canManageRoles ? <td className="py-2">{a.scopeType === 'outlet' ? <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => setRevokeRoleTarget({ userId: a.userId, outletId: a.scopeId, roleCode: a.roleCode, userName: selectedUser.fullName || selectedUser.username, roleName: roleRefs.find((r) => r.code === a.canonicalRole)?.name || a.canonicalRole })}>Revoke</Button> : null}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody></table>}
                </TabsContent>

                <TabsContent value="permissions" className="mt-3">
                  {canManageRoles ? (
                    <div className="mb-3 flex justify-end">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setGrantPermUserId(selectedUser.id); setGrantPermCode(''); setGrantPermOutletId(scopedOutletId || ''); setGrantPermOpen(true); }}>Grant Permission</Button>
                    </div>
                  ) : null}
                  {selectedUserOverrides.length === 0 ? <EmptyState title="No permissions" description="No direct permission grants." />
                  : <table className="w-full text-sm"><tbody className="divide-y divide-border">
                    {selectedUserOverrides.map((r, i) => (
                      <tr key={`${r.permissionCode}:${r.outletId}:${i}`}>
                        <td className="py-2 pr-2 text-xs">{r.permissionName || r.permissionCode}{IAM_SENSITIVE_PERMISSION_CODES.has(r.permissionCode) ? <Badge variant="outline" className="ml-1 border-amber-300 bg-amber-50 text-[10px] text-amber-700">!</Badge> : null}</td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">{r.outletName || r.outletId}</td>
                        <td className="py-2 text-xs text-muted-foreground">{formatDateTime(r.assignedAt)}</td>
                        {canManageRoles ? <td className="py-2"><Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => setRevokePermTarget({ userId: r.userId, outletId: r.outletId, permissionCode: r.permissionCode, userName: selectedUser.fullName || selectedUser.username, permName: r.permissionName || r.permissionCode })}>Revoke</Button></td> : null}
                      </tr>
                    ))}
                  </tbody></table>}
                </TabsContent>

                <TabsContent value="effective-access" className="mt-3 space-y-2">
                  {selectedUserAccess.slice(0, 12).map((r) => (
                    <div key={r.id} className="rounded-md border border-border p-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium">{r.capability}</span>
                        <EffectBadge effect={r.effect} />
                        <ScopePill scopeType={r.scopeType} label={r.scopeLabel} />
                        <SourceBadge sourceType={r.sourceType} label={r.sourceLabel} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.explanation}</p>
                    </div>
                  ))}
                  {selectedUserAccess.length > 12 ? <p className="text-xs text-muted-foreground">+ {selectedUserAccess.length - 12} more rows — open Effective Access view.</p> : null}
                </TabsContent>

                <TabsContent value="activity" className="mt-3">
                  {activityLoading ? <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  : userActivityRows.length === 0 ? <EmptyState title="No activity" description="No auth events for this user." />
                  : <div className="space-y-2">{userActivityRows.map((r) => (
                    <div key={r.id} className="rounded-md border border-border p-2.5">
                      <div className="flex items-center gap-2"><Badge variant="outline" className={cn('text-[10px]', r.tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-blue-300 bg-blue-50 text-blue-700')}>{r.tone === 'warning' ? 'Security' : 'Audit'}</Badge><span className="text-xs font-medium">{r.title}</span></div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(r.createdAt)}</p>
                    </div>
                  ))}</div>}
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ═══════ ASSIGNMENT SHEET ═══════ */}
      <Sheet open={assignSheetOpen} onOpenChange={setAssignSheetOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Invite / Assign User</SheetTitle>
            <SheetDescription>Create a user and assign a role at an outlet or region.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-5">
            <section className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">User Profile</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="text-xs text-muted-foreground">Username</label><Input className="mt-1 h-8" value={assignForm.username} onChange={(e) => setAssignForm((f) => ({ ...f, username: e.target.value }))} /></div>
                <div><label className="text-xs text-muted-foreground">Password</label><Input type="password" className="mt-1 h-8" value={assignForm.password} onChange={(e) => setAssignForm((f) => ({ ...f, password: e.target.value }))} /></div>
                <div><label className="text-xs text-muted-foreground">Full Name</label><Input className="mt-1 h-8" value={assignForm.fullName} onChange={(e) => setAssignForm((f) => ({ ...f, fullName: e.target.value }))} /></div>
                <div><label className="text-xs text-muted-foreground">Email</label><Input className="mt-1 h-8" value={assignForm.email} onChange={(e) => setAssignForm((f) => ({ ...f, email: e.target.value }))} /></div>
              </div>
            </section>
            <Separator />
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Scope</p>
                <div className="flex rounded-md border border-input p-0.5">
                  <button type="button" onClick={() => setAssignMode('outlet')} className={cn('rounded px-2.5 py-1 text-xs', assignMode === 'outlet' ? 'bg-foreground text-background' : 'text-muted-foreground')}>Outlet</button>
                  <button type="button" onClick={() => setAssignMode('region')} className={cn('rounded px-2.5 py-1 text-xs', assignMode === 'region' ? 'bg-foreground text-background' : 'text-muted-foreground')}>Region</button>
                </div>
              </div>
              {!canManageRoles ? <PermissionBanner state="action_disabled" moduleName="Role" detail="auth.role.write needed." /> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">Role</label>
                  <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={assignForm.roleCode} disabled={!canManageRoles} onChange={(e) => setAssignForm((f) => ({ ...f, roleCode: e.target.value }))}>
                    <option value="">Select role</option>
                    {roleRefs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </div>
                {assignMode === 'outlet' ? (
                  <div><label className="text-xs text-muted-foreground">Outlet</label>
                    <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={assignForm.outletId} onChange={(e) => setAssignForm((f) => ({ ...f, outletId: e.target.value }))}>
                      <option value="">Select outlet</option>{outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div><label className="text-xs text-muted-foreground">Region</label>
                    <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={assignForm.regionId} onChange={(e) => setAssignForm((f) => ({ ...f, regionId: e.target.value }))}>
                      <option value="">Select region</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {assignForm.roleCode ? (() => { const sr = roleRefs.find((r) => r.code === assignForm.roleCode); return sr ? (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-center gap-2"><RoleBadge label={sr.name} tone={sr.tone} />{sr.badge ? <RoleBadge label={sr.badge} tone={sr.tone} /> : null}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{sr.description}</p>
                </div>
              ) : null; })() : null}
            </section>
            {assignMode === 'region' && assignForm.regionId && assignForm.roleCode ? (
              <>
                <Separator />
                <section className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Fan-out Preview</p>
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    {previewRows.filter((r) => r.status === 'new').length} new outlet records will be created.
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">#</th><th className="py-1">Outlet</th><th className="py-1">Status</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {previewRows.map((r, i) => (
                        <tr key={r.outletId}>
                          <td className="py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                          <td className="py-1.5 text-xs">{r.outletName}</td>
                          <td className="py-1.5"><Badge variant="outline" className={cn('text-[10px]', r.status === 'new' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-500')}>{r.status === 'new' ? 'New' : 'Exists'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-muted-foreground">New outlets added to this region later will NOT auto-inherit.</p>
                </section>
              </>
            ) : null}
          </div>
          <SheetFooter className="mt-6 border-t border-border pt-4">
            <Button variant="outline" onClick={() => setAssignSheetOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitAssignment()} disabled={creatingUser}>
              {creatingUser ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Creating...</> : 'Create User'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ═══════ Dialogs ═══════ */}
      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(o) => { if (!o) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{pendingAction?.title || 'Unavailable'}</AlertDialogTitle><AlertDialogDescription>{pendingAction?.detail || 'Not available.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogAction onClick={() => setPendingAction(null)}>Close</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(sessionToRevoke)} onOpenChange={(o) => { if (!o) setSessionToRevoke(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Revoke Session</AlertDialogTitle><AlertDialogDescription>This will revoke session {sessionToRevoke?.sessionId} immediately.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" size="sm" onClick={async () => {
              if (!token || !sessionToRevoke) return;
              try { await authApi.revokeSession(token, sessionToRevoke.sessionId); toast.success('Session revoked'); setSessionToRevoke(null); void loadSessions(); }
              catch (e: unknown) { toast.error(getErrorMessage(e, 'Unable to revoke session')); }
            }}>Revoke</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════ Revoke Role Confirmation ═══════ */}
      <AlertDialog open={Boolean(revokeRoleTarget)} onOpenChange={(o) => { if (!o) setRevokeRoleTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Role</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{revokeRoleTarget?.roleName}</strong> from <strong>{revokeRoleTarget?.userName}</strong> at this outlet? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" size="sm" onClick={() => void doRevokeRoleConfirmed()}>Revoke</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════ Revoke Permission Confirmation ═══════ */}
      <AlertDialog open={Boolean(revokePermTarget)} onOpenChange={(o) => { if (!o) setRevokePermTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Permission</AlertDialogTitle>
            <AlertDialogDescription>
              Remove permission <strong>{revokePermTarget?.permName}</strong> from <strong>{revokePermTarget?.userName}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" size="sm" onClick={() => void doRevokePermissionConfirmed()}>Revoke</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════ Assign Role Sheet ═══════ */}
      <Sheet open={assignRoleOpen} onOpenChange={setAssignRoleOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Assign Role</SheetTitle>
            <SheetDescription>Assign a canonical role to {assignRoleUserName} at an outlet.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={assignRoleCode} onChange={(e) => setAssignRoleCode(e.target.value)}>
                <option value="">Select role...</option>
                {roleRefs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Outlet</label>
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={assignRoleOutletId} onChange={(e) => setAssignRoleOutletId(e.target.value)}>
                <option value="">Select outlet...</option>
                {outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name} ({o.code})</option>)}
              </select>
            </div>
            {assignRoleCode === 'superadmin' ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Superadmin grants unrestricted access to all domains across all outlets.</div> : null}
            {assignRoleCode === 'admin' ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">Admin is governance-only — no business operations.</div> : null}
            {assignRoleCode && assignRoleOutletId ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Will assign <strong>{roleRefs.find((r) => r.code === assignRoleCode)?.name || assignRoleCode}</strong> at <strong>{outlets.find((o) => String(o.id) === assignRoleOutletId)?.name || assignRoleOutletId}</strong> to <strong>{assignRoleUserName}</strong>.
              </div>
            ) : null}
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setAssignRoleOpen(false)}>Cancel</Button>
            <Button disabled={!assignRoleCode || !assignRoleOutletId || assignRoleBusy} onClick={() => void doAssignRole()}>
              {assignRoleBusy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Assigning...</> : 'Assign Role'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ═══════ Grant Permission Sheet ═══════ */}
      <Sheet open={grantPermOpen} onOpenChange={setGrantPermOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Grant Permission</SheetTitle>
            <SheetDescription>Direct permissions are fallback grants for edge cases where canonical roles don't provide the needed access.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            {/* User selector — shown only when opened from global Permissions view */}
            {grantPermUserId ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">User</label>
                <p className="mt-1 text-sm font-medium">{users.find((u) => u.id === grantPermUserId)?.fullName || grantPermUserId}</p>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">User</label>
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={grantPermUserId} onChange={(e) => setGrantPermUserId(e.target.value)}>
                  <option value="">Select user...</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.username} ({u.username})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Permission</label>
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={grantPermCode} onChange={(e) => setGrantPermCode(e.target.value)}>
                <option value="">Select permission...</option>
                {permRefs.map((p) => <option key={p.code} value={p.code}>{p.label} — {p.code}{p.sensitive ? ' (sensitive)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Outlet</label>
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={grantPermOutletId} onChange={(e) => setGrantPermOutletId(e.target.value)}>
                <option value="">Select outlet...</option>
                {outlets.map((o) => <option key={o.id} value={String(o.id)}>{o.name} ({o.code})</option>)}
              </select>
            </div>
            {IAM_SENSITIVE_PERMISSION_CODES.has(grantPermCode) ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">This is a sensitive permission. Ensure this grant is intentional and reviewed.</div> : null}
            {grantPermUserId && grantPermCode && grantPermOutletId ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Will grant <strong>{grantPermCode}</strong> to <strong>{users.find((u) => u.id === grantPermUserId)?.fullName || grantPermUserId}</strong> at <strong>{outlets.find((o) => String(o.id) === grantPermOutletId)?.name || grantPermOutletId}</strong>.
              </div>
            ) : null}
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setGrantPermOpen(false)}>Cancel</Button>
            <Button disabled={!grantPermUserId || !grantPermCode || !grantPermOutletId || grantPermBusy} onClick={() => void doGrantPermission()}>
              {grantPermBusy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Granting...</> : 'Grant Permission'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ═══════ Manage Role Permissions Sheet ═══════ */}
      <Sheet open={rolePermOpen} onOpenChange={(o) => { if (!o) setRolePermOpen(false); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Manage Permissions — {rolePermCode}</SheetTitle>
            <SheetDescription>Select which permissions are assigned to this role. Saving replaces the entire permission set.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>This action <strong>replaces</strong> the full permission set for this role. Unchecked permissions will be removed.</span>
            </div>
            <div className="space-y-2">
              {permRefs.map((p) => (
                <label key={p.code} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-2.5 hover:bg-muted/20">
                  <Checkbox
                    checked={selectedPerms.has(p.code)}
                    onCheckedChange={(checked) => {
                      setSelectedPerms((prev) => {
                        const next = new Set(prev);
                        if (checked === true) next.add(p.code); else next.delete(p.code);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{p.label}</span>
                      {p.sensitive ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700">Sensitive</Badge> : null}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{p.code}</p>
                    <p className="text-[10px] text-muted-foreground">{p.businessMeaning}</p>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{selectedPerms.size} permission{selectedPerms.size !== 1 ? 's' : ''} selected.</p>
          </div>
          <SheetFooter className="mt-6 border-t border-border pt-4">
            <Button variant="outline" onClick={() => setRolePermOpen(false)}>Cancel</Button>
            <Button disabled={rolePermBusy} onClick={() => void doSaveRolePermissions()}>
              {rolePermBusy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving...</> : 'Save Permissions'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
