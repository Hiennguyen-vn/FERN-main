import { useMemo } from 'react';
import { Globe, MapPin, Store, Check } from 'lucide-react';
import type { ShellScope, ScopeOption } from '@/types/shell';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';

interface ScopeSelectorProps {
  open: boolean;
  onClose: () => void;
  currentScope: ShellScope;
  scopeTree: ScopeOption[];
  onScopeChange: (scope: ShellScope) => void;
}

function parseSubRegion(name: string): string | null {
  const m = name.match(/\b([A-Z]{2}-[A-Z]{2,})\b/);
  return m ? m[1] : null;
}

type OutletEntry = { region: ScopeOption; outlet: ScopeOption; subRegion: string | null };

export function ScopeSelector({ open, onClose, currentScope, scopeTree, onScopeChange }: ScopeSelectorProps) {
  const systemNode = scopeTree[0];

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

  const outletEntries = useMemo<OutletEntry[]>(() => {
    const result: OutletEntry[] = [];
    for (const region of leafRegions) {
      for (const outlet of region.children || []) {
        result.push({ region, outlet, subRegion: parseSubRegion(outlet.name) });
      }
    }
    return result;
  }, [leafRegions]);

  const subRegionGroups = useMemo(() => {
    const map = new Map<string, OutletEntry[]>();
    for (const entry of outletEntries) {
      const key = entry.subRegion ?? '—';
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [outletEntries]);

  const pickSystem = () => {
    onScopeChange({ level: 'system' });
    onClose();
  };

  const pickRegion = (region: ScopeOption) => {
    onScopeChange({ level: 'region', regionId: region.id, regionName: region.name, regionCode: region.code });
    onClose();
  };

  const pickOutlet = (region: ScopeOption, outlet: ScopeOption) => {
    onScopeChange({
      level: 'outlet',
      regionId: region.id,
      regionName: region.name,
      regionCode: region.code,
      outletId: outlet.id,
      outletName: outlet.name,
      outletCode: outlet.code,
    });
    onClose();
  };

  const isSystemActive = currentScope.level === 'system';
  const isRegionActive = (id: string) =>
    currentScope.level === 'region' && currentScope.regionId === id && !currentScope.outletId;
  const isOutletActive = (id: string) => currentScope.outletId === id;

  return (
    <CommandDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <CommandInput placeholder="Search region, sub-region, or outlet..." />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No scope found.</CommandEmpty>

        <CommandGroup heading="All">
          <CommandItem
            value="all-system all regions vietnam"
            onSelect={pickSystem}
            className="gap-2"
          >
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span>All Regions</span>
            <CommandShortcut>System</CommandShortcut>
            {isSystemActive && <Check className="h-4 w-4 text-primary ml-1" />}
          </CommandItem>
          {leafRegions.map((region) => (
            <CommandItem
              key={`region-${region.id}`}
              value={`region ${region.name} ${region.code ?? ''}`}
              onSelect={() => pickRegion(region)}
              className="gap-2"
            >
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>All {region.name}</span>
              {region.code && (
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {region.code}
                </span>
              )}
              <CommandShortcut>{region.children?.length ?? 0} outlets</CommandShortcut>
              {isRegionActive(region.id) && <Check className="h-4 w-4 text-primary ml-1" />}
            </CommandItem>
          ))}
        </CommandGroup>

        {subRegionGroups.map(([subRegion, entries]) => (
          <div key={subRegion}>
            <CommandSeparator />
            <CommandGroup heading={subRegion}>
              {entries.map(({ region, outlet }) => (
                <CommandItem
                  key={outlet.id}
                  value={`outlet ${outlet.name} ${outlet.code ?? ''} ${region.name}`}
                  onSelect={() => pickOutlet(region, outlet)}
                  className="gap-2"
                >
                  <Store className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{outlet.name}</span>
                  {outlet.code && (
                    <span className="font-mono text-[10px] text-muted-foreground">{outlet.code}</span>
                  )}
                  {isOutletActive(outlet.id) && <Check className="h-4 w-4 text-primary ml-1" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
