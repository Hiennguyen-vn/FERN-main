import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Monitor, Package, Warehouse, ShoppingCart,
  Landmark, Users, CalendarClock, Building2, Map, BarChart3,
  ScrollText, Shield,
} from 'lucide-react';
import type { ModuleEntry, ModuleFamily } from '@/types/shell';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, Monitor, Package, Warehouse, ShoppingCart,
  Landmark, Users, CalendarClock, Building2, Map, BarChart3,
  ScrollText, Shield,
};

const MODULE_GROUPS: { label: string; families: ModuleFamily[] }[] = [
  { label: 'Core', families: ['home', 'pos'] },
  { label: 'Operations', families: ['catalog', 'inventory', 'procurement'] },
  { label: 'Finance & People', families: ['finance', 'hr', 'workforce'] },
  { label: 'Organization', families: ['org', 'regional-ops'] },
  { label: 'Insights', families: ['reports', 'audit'] },
  { label: 'Administration', families: ['iam'] },
];

interface AppSidebarProps {
  modules: ModuleEntry[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: (family: ModuleFamily) => void;
  activeFamily?: string;
}

export function AppSidebar({ modules, collapsed, onNavigate, activeFamily }: AppSidebarProps) {
  const location = useLocation();
  const moduleMap: Record<string, ModuleEntry> = {};
  modules.forEach(m => { moduleMap[m.family] = m; });

  return (
    <aside
      className={cn(
        'h-screen flex flex-col border-r transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-14' : 'w-64'
      )}
      style={{
        background: 'hsl(var(--sidebar-background))',
        borderColor: 'hsl(var(--sidebar-border))',
      }}
    >
      {/* Logo */}
      <div className={cn('h-14 flex items-center border-b px-4 flex-shrink-0', collapsed && 'justify-center px-0')}
        style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-primary-foreground font-bold text-xs">O</span>
        </div>
        {!collapsed && (
          <span className="ml-2.5 text-sm font-semibold" style={{ color: 'hsl(var(--sidebar-accent-foreground))' }}>
            OpsCenter
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-4">
        {MODULE_GROUPS.map((group) => {
          const groupModules = group.families
            .map(f => moduleMap[f])
            .filter((m): m is ModuleEntry => !!m);

          if (groupModules.length === 0) return null;

          return (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'hsl(var(--sidebar-muted))' }}>
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5 px-2">
                {groupModules.map((mod) => {
                  const Icon = ICON_MAP[mod.icon] || LayoutDashboard;
                  const active = activeFamily ? mod.family === activeFamily : location.pathname.startsWith(mod.path);

                  return (
                    <button
                      key={mod.family}
                      onClick={() => onNavigate?.(mod.family)}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-md text-sm transition-colors',
                        collapsed ? 'justify-center h-9 w-10 mx-auto' : 'px-3 h-9',
                        active
                          ? 'font-medium'
                          : 'hover:bg-[hsl(var(--sidebar-accent))]'
                      )}
                      style={{
                        color: active
                          ? 'hsl(var(--sidebar-primary))'
                          : 'hsl(var(--sidebar-foreground))',
                        background: active
                          ? 'hsl(var(--sidebar-accent))'
                          : undefined,
                      }}
                      title={collapsed ? mod.label : undefined}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {!collapsed && <span>{mod.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
