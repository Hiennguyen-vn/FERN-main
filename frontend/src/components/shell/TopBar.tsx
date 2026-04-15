import {
  Search, Bell, ChevronDown, PanelLeftClose, PanelLeft, Zap, LogOut, Settings, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ShellScope } from '@/types/shell';
import { cn } from '@/lib/utils';

interface TopBarProps {
  pageTitle: string;
  breadcrumbs?: string[];
  scope: ShellScope;
  user: { displayName: string; persona: string; avatarInitials: string };
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenScope: () => void;
  onOpenQuickActions: () => void;
  onOpenNotifications: () => void;
  onLogout: () => void;
  notificationCount?: number;
}

function ScopeChips({ scope }: { scope: ShellScope }) {
  const chips: { label: string; className: string }[] = [];

  if (scope.level === 'system') {
    chips.push({ label: 'System', className: 'scope-chip scope-chip-system' });
  }
  if (scope.regionName) {
    chips.push({ label: scope.regionName, className: 'scope-chip scope-chip-region' });
  }
  if (scope.outletName) {
    chips.push({ label: scope.outletName, className: 'scope-chip scope-chip-outlet' });
  }

  return (
    <div className="flex items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.label} className={c.className}>{c.label}</span>
      ))}
    </div>
  );
}

export function TopBar({
  pageTitle,
  breadcrumbs,
  scope,
  user,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenScope,
  onOpenQuickActions,
  onOpenNotifications,
  onLogout,
  notificationCount = 3,
}: TopBarProps) {
  return (
    <header className="shell-topbar">
      {/* Sidebar toggle */}
      <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8 flex-shrink-0 text-muted-foreground">
        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>

      {/* Breadcrumb / Title */}
      <div className="flex items-center gap-2 min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-border">/</span>}
                <span className="hover:text-foreground cursor-pointer transition-colors">{b}</span>
              </span>
            ))}
            <span className="text-border">/</span>
          </div>
        )}
        <h1 className="text-sm font-semibold text-foreground truncate">{pageTitle}</h1>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="hidden md:flex items-center gap-2 h-8 px-3 rounded-md bg-muted text-muted-foreground text-sm cursor-pointer hover:bg-accent transition-colors min-w-[200px] max-w-[280px]">
        <Search className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="text-xs">Search…</span>
        <span className="ml-auto text-[10px] bg-background px-1.5 py-0.5 rounded border">⌘K</span>
      </div>

      {/* Quick actions */}
      <Button variant="ghost" size="icon" onClick={onOpenQuickActions} className="h-8 w-8 text-muted-foreground">
        <Zap className="h-4 w-4" />
      </Button>

      {/* Notifications */}
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground relative" onClick={onOpenNotifications}>
        <Bell className="h-4 w-4" />
        {notificationCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive text-[9px] text-destructive-foreground flex items-center justify-center font-medium">
            {notificationCount}
          </span>
        )}
      </Button>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 h-8 pl-2 pr-1 rounded-md hover:bg-accent transition-colors">
            <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">{user.avatarInitials}</span>
            </div>
            <div className={cn('hidden xl:block text-left')}>
              <p className="text-xs font-medium text-foreground leading-none">{user.displayName}</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{user.persona}</p>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground hidden xl:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.displayName}</p>
            <p className="text-xs text-muted-foreground">{user.persona}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 cursor-pointer">
            <User className="h-4 w-4" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 cursor-pointer">
            <Settings className="h-4 w-4" /> Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 cursor-pointer text-destructive focus:text-destructive" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
