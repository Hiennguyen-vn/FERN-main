import {
  Plus, ClipboardCheck, FileText, PackagePlus, CheckCircle, Clock, X,
} from 'lucide-react';
import type { QuickAction, ShellScope, ActionHub } from '@/types/shell';
import { cn } from '@/lib/utils';

const ACTION_ICONS: Record<string, React.ElementType> = {
  Plus, ClipboardCheck, FileText, PackagePlus, CheckCircle, Clock,
};

interface QuickActionsPanelProps {
  open: boolean;
  onClose: () => void;
  actionHub: ActionHub;
  scope: ShellScope;
}

export function QuickActionsPanel({ open, onClose, actionHub, scope }: QuickActionsPanelProps) {
  if (!open) return null;

  const availableActions = actionHub.quickActions.filter(
    (a) => !a.scope || a.scope.includes(scope.level)
  );

  return (
    <>
      <div className="fixed inset-0 bg-foreground/20 z-40" onClick={onClose} />
      <div className="fixed right-4 top-16 w-[340px] bg-card rounded-xl border shadow-surface-xl z-50 animate-fade-in">
        <div className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Quick Actions</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Actions available for your current scope
          </p>
        </div>

        <div className="p-3 space-y-1">
          {availableActions.map((action) => {
            const Icon = ACTION_ICONS[action.icon] || Plus;
            return (
              <button
                key={action.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent transition-colors text-foreground"
              >
                <div className="h-8 w-8 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-sm">{action.label}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{action.module}</p>
                </div>
              </button>
            );
          })}
        </div>

        {actionHub.recentItems.length > 0 && (
          <div className="border-t px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent</p>
            <div className="space-y-1">
              {actionHub.recentItems.map((item) => (
                <button
                  key={item.path}
                  className="w-full text-left text-xs text-foreground hover:text-primary transition-colors py-1"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
