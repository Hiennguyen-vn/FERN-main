import { useMemo } from 'react';
import { Globe, MapPin, Store, ChevronDown, Check } from 'lucide-react';
import type { ShellScope, ScopeOption, ScopeLevel } from '@/types/shell';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ScopeBarProps {
  currentScope: ShellScope;
  scopeTree: ScopeOption[];
  onScopeChange: (scope: ShellScope) => void;
}

const LEVEL_ICON: Record<ScopeLevel, React.ElementType> = {
  system: Globe,
  region: MapPin,
  outlet: Store,
};

export function ScopeBar({ currentScope, scopeTree, onScopeChange }: ScopeBarProps) {
  const systemNode = scopeTree[0];

  // Only regions that directly contain outlets (skip pure parent nodes)
  const leafRegions = useMemo(() => {
    const result: ScopeOption[] = [];
    function walk(nodes: ScopeOption[]) {
      for (const node of nodes) {
        if (node.level === 'region' && node.children?.some((c) => c.level === 'outlet')) {
          result.push(node);
        }
        if (node.children) walk(node.children);
      }
    }
    walk(systemNode?.children || []);
    return result;
  }, [systemNode]);

  const totalOutlets = useMemo(
    () => leafRegions.reduce((sum, r) => sum + (r.children?.length || 0), 0),
    [leafRegions],
  );

  // Single outlet → hidden (auto-selected by ShellLayout)
  if (totalOutlets <= 1) return null;

  const selectedRegion = leafRegions.find((r) => r.id === currentScope.regionId) || null;
  const outlets = selectedRegion?.children || [];
  const hasMultipleRegions = leafRegions.length > 1;

  const ScopeIcon = LEVEL_ICON[currentScope.level];

  const selectRegion = (region: ScopeOption) => {
    onScopeChange({ level: 'region', regionId: region.id, regionName: region.name });
  };

  const selectOutlet = (region: ScopeOption, outlet: ScopeOption) => {
    onScopeChange({
      level: 'outlet',
      regionId: region.id,
      regionName: region.name,
      outletId: outlet.id,
      outletName: outlet.name,
    });
  };

  return (
    <div className="scope-bar">
      {/* Left: scope icon + label */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
        <ScopeIcon className="h-3.5 w-3.5" />
      </div>

      {/* Region picker (dropdown only when multiple regions) */}
      {hasMultipleRegions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn('scope-bar-select', !currentScope.regionId && 'scope-bar-select-prompt')}>
              <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{currentScope.regionName || 'Select region'}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => onScopeChange({ level: 'system' })}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>All Regions</span>
              {currentScope.level === 'system' && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {leafRegions.map((region) => (
              <DropdownMenuItem
                key={region.id}
                className="gap-2 cursor-pointer"
                onClick={() => selectRegion(region)}
              >
                <MapPin className="h-3.5 w-3.5" />
                <span className="flex-1 truncate">{region.name}</span>
                <span className="text-[10px] text-muted-foreground">{region.children?.length || 0}</span>
                {currentScope.regionId === region.id && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : leafRegions.length === 1 ? (
        <span className="text-xs font-medium text-foreground truncate flex-shrink-0">
          {leafRegions[0].name}
        </span>
      ) : null}

      {/* Divider before outlet chips */}
      {selectedRegion && outlets.length > 0 && <div className="scope-bar-divider" />}

      {/* Outlet chips — inline, scrollable */}
      {selectedRegion && outlets.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0">
          {/* "All" chip = region-level scope */}
          <button
            onClick={() => selectRegion(selectedRegion)}
            className={cn(
              'scope-bar-chip',
              currentScope.level === 'region' && currentScope.regionId === selectedRegion.id && !currentScope.outletId
                ? 'scope-bar-chip-active'
                : 'scope-bar-chip-idle',
            )}
          >
            <MapPin className="h-3 w-3" />
            All
          </button>

          {outlets.map((outlet) => {
            const isActive = currentScope.outletId === outlet.id;
            return (
              <button
                key={outlet.id}
                onClick={() => selectOutlet(selectedRegion, outlet)}
                className={cn(
                  'scope-bar-chip',
                  isActive ? 'scope-bar-chip-active' : 'scope-bar-chip-idle',
                )}
                title={outlet.name}
              >
                <Store className="h-3 w-3" />
                <span className="truncate max-w-[140px]">{outlet.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
