import { useState } from 'react';
import { Globe, MapPin, Store, ChevronRight, Info, X } from 'lucide-react';
import type { ShellScope, ScopeOption, ScopeLevel } from '@/types/shell';
import { cn } from '@/lib/utils';

interface ScopeSelectorProps {
  open: boolean;
  onClose: () => void;
  currentScope: ShellScope;
  scopeTree: ScopeOption[];
  onScopeChange: (scope: ShellScope) => void;
}

const SCOPE_ICONS: Record<ScopeLevel, React.ElementType> = {
  system: Globe,
  region: MapPin,
  outlet: Store,
};

const SCOPE_LABELS: Record<ScopeLevel, string> = {
  system: 'System-wide',
  region: 'Region',
  outlet: 'Outlet',
};

export function ScopeSelector({ open, onClose, currentScope, scopeTree, onScopeChange }: ScopeSelectorProps) {
  const [expandedRegion, setExpandedRegion] = useState<string | null>(
    currentScope.regionId || null
  );

  if (!open) return null;

  const systemNode = scopeTree[0];
  const regions = systemNode?.children || [];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-foreground/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-4 top-16 w-[380px] max-h-[calc(100vh-5rem)] bg-card rounded-xl border shadow-surface-xl z-50 flex flex-col animate-fade-in">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Scope Selection</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Changing scope adjusts data visibility and available actions across the platform.
          </p>
        </div>

        {/* Info banner */}
        <div className="mx-4 mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-info/5 border border-info/10">
          <Info className="h-3.5 w-3.5 text-info mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your accessible scope depends on your role permissions. Some levels may not be available.
          </p>
        </div>

        {/* Scope tree */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {/* System */}
          <button
            onClick={() => {
              onScopeChange({ level: 'system' });
              onClose();
            }}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              currentScope.level === 'system' && !currentScope.regionId
                ? 'bg-primary/8 border border-primary/15 text-primary font-medium'
                : 'hover:bg-accent text-foreground'
            )}
          >
            <Globe className="h-4 w-4 flex-shrink-0" />
            <span>All Regions</span>
            <span className="ml-auto scope-chip scope-chip-system text-[10px]">System</span>
          </button>

          {/* Regions */}
          {regions.map((region) => {
            const isExpanded = expandedRegion === region.id;
            const isActive = currentScope.regionId === region.id && currentScope.level === 'region';

            return (
              <div key={region.id}>
                <div className="flex items-center">
                  <button
                    onClick={() => setExpandedRegion(isExpanded ? null : region.id)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
                  </button>
                  <button
                    onClick={() => {
                      onScopeChange({ level: 'region', regionId: region.id, regionName: region.name });
                      onClose();
                    }}
                    className={cn(
                      'flex-1 flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors',
                      isActive
                        ? 'bg-primary/8 border border-primary/15 text-primary font-medium'
                        : 'hover:bg-accent text-foreground'
                    )}
                  >
                    <MapPin className="h-4 w-4 flex-shrink-0" />
                    <span>{region.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {region.children?.length || 0} outlets
                    </span>
                  </button>
                </div>

                {/* Outlets */}
                {isExpanded && region.children && (
                  <div className="ml-8 mt-0.5 space-y-0.5">
                    {region.children.map((outlet) => {
                      const isOutletActive = currentScope.outletId === outlet.id;
                      return (
                        <button
                          key={outlet.id}
                          onClick={() => {
                            onScopeChange({
                              level: 'outlet',
                              regionId: region.id,
                              regionName: region.name,
                              outletId: outlet.id,
                              outletName: outlet.name,
                            });
                            onClose();
                          }}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                            isOutletActive
                              ? 'bg-primary/8 border border-primary/15 text-primary font-medium'
                              : 'hover:bg-accent text-foreground'
                          )}
                        >
                          <Store className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>{outlet.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Current scope footer */}
        <div className="px-5 py-3 border-t bg-muted/50">
          <div className="flex items-center gap-2">
            {(() => {
              const Icon = SCOPE_ICONS[currentScope.level];
              return <Icon className="h-3.5 w-3.5 text-muted-foreground" />;
            })()}
            <p className="text-xs text-muted-foreground">
              Active: <span className="font-medium text-foreground">
                {currentScope.outletName || currentScope.regionName || 'System-wide'}
              </span>
              <span className="ml-1.5 text-muted-foreground">({SCOPE_LABELS[currentScope.level]})</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
