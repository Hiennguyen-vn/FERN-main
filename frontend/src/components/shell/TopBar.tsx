import {
  Bell, ChevronDown, PanelLeftClose, PanelLeft, LogOut, Globe, MapPin, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import type { ShellScope } from '@/types/shell';
import { cn } from '@/lib/utils';
import { getLocale, setLocale, type Locale } from '@/lib/i18n';
import { useState } from 'react';

interface TopBarProps {
  pageTitle: string;
  breadcrumbs?: string[];
  scope: ShellScope;
  user: { displayName: string; persona: string; avatarInitials: string };
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenScope: () => void;
  onOpenNotifications: () => void;
  onLogout: () => void;
  notificationCount?: number;
}

function parseSubRegion(name: string | undefined): string | null {
  if (!name) return null;
  const m = name.match(/\b([A-Z]{2}-[A-Z]{2,})\b/);
  return m ? m[1] : null;
}

function shortOutletLabel(name: string | undefined): string {
  if (!name) return '';
  const dash = name.indexOf(' - ');
  if (dash > 0) return name.slice(0, dash).trim();
  const suffix = name.match(/[A-Z]+-(\d+)\s*$/i);
  if (suffix) return `Outlet ${suffix[1]}`;
  return name;
}

function ScopeChips({ scope, onClick }: { scope: ShellScope; onClick: () => void }) {
  const segments: string[] = [];

  if (scope.level === 'system') {
    segments.push('All Regions');
  } else if (scope.regionName) {
    segments.push(scope.regionCode || scope.regionName);
    const subRegion = parseSubRegion(scope.outletName);
    if (subRegion) segments.push(subRegion);
    if (scope.outletName) {
      segments.push(scope.outletCode || shortOutletLabel(scope.outletName));
    } else {
      segments.push('All outlets');
    }
  } else {
    segments.push('Select scope');
  }

  const titleParts: string[] = [];
  if (scope.regionName) titleParts.push(scope.regionName + (scope.regionCode ? ` (${scope.regionCode})` : ''));
  if (scope.outletName) titleParts.push(scope.outletName + (scope.outletCode ? ` · ${scope.outletCode}` : ''));

  return (
    <button
      onClick={onClick}
      title={titleParts.join(' › ') || 'Change scope'}
      className="hidden sm:flex items-center gap-1.5 h-8 rounded-md border border-border/60 bg-card px-2.5 hover:border-border hover:bg-accent transition-colors"
    >
      <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="flex items-center gap-1 text-xs text-foreground max-w-[280px] truncate">
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-border">›</span>}
            <span className={cn(
              'truncate',
              i === segments.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}>
              {seg}
            </span>
          </span>
        ))}
      </span>
      <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

export function TopBar({
  pageTitle,
  scope,
  user,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenScope,
  onOpenNotifications,
  onLogout,
  notificationCount = 3,
}: TopBarProps) {
  const navigate = useNavigate();
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const toggleLocale = () => {
    const next: Locale = locale === 'vi' ? 'en' : 'vi';
    const onPosScreen = window.location.pathname.includes('/pos');
    if (onPosScreen) {
      const confirmed = window.confirm(
        next === 'en'
          ? 'Switching language will reload the page. Unsaved cart items will be lost. Continue?'
          : 'Đổi ngôn ngữ sẽ tải lại trang. Các món chưa lưu trong giỏ sẽ mất. Tiếp tục?',
      );
      if (!confirmed) return;
    }
    setLocale(next);
    setLocaleState(next);
    window.location.reload();
  };
  return (
    <header className="shell-topbar">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8 flex-shrink-0 text-muted-foreground">
        {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>

      <h1 className="text-sm font-semibold text-foreground truncate">{pageTitle}</h1>

      <div className="flex-1" />

      <ScopeChips scope={scope} onClick={onOpenScope} />

      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs text-muted-foreground gap-1.5"
        onClick={toggleLocale}
        aria-label={`Language: ${locale.toUpperCase()} — click to switch`}
        title={`Language: ${locale.toUpperCase()} — click to switch`}
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium uppercase">{locale}</span>
      </Button>

      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground relative" onClick={onOpenNotifications}>
        <Bell className="h-4 w-4" />
        {notificationCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive text-[9px] text-destructive-foreground flex items-center justify-center font-medium">
            {notificationCount}
          </span>
        )}
      </Button>

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
          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => navigate('/profile')}>
            <User className="h-4 w-4" /> My Account
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
