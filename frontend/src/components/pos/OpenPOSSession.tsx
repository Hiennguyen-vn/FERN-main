import { useState } from 'react';
import {
  Monitor, Wifi, WifiOff, Clock, CalendarDays, User, AlertTriangle,
  Loader2, ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  outletName: string;
  operatorName: string;
  hasOpenSession: boolean;
  onBack: () => void;
  onOpen: (note?: string) => void;
}

export function OpenPOSSession({ outletName, operatorName, hasOpenSession, onBack, onOpen }: Props) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [online] = useState(true);
  const now = new Date();

  const handleOpen = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onOpen(note || undefined);
    }, 600);
  };

  return (
    <div className="p-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </button>

      <div className="max-w-lg mx-auto">
        <div className="surface-elevated p-6 space-y-6">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Monitor className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Open POS Session</h2>
            <p className="text-sm text-muted-foreground mt-1">Start a new point-of-sale session for this outlet</p>
          </div>

          {/* Online-only notice */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-info/5 border border-info/10">
            {online ? <Wifi className="h-3.5 w-3.5 text-info" /> : <WifiOff className="h-3.5 w-3.5 text-destructive" />}
            <div>
              <p className="text-[11px] font-medium text-foreground">
                {online ? 'Online — connected' : 'Offline — cannot open session'}
              </p>
              <p className="text-[10px] text-muted-foreground">POS operates in online-only mode. A stable connection is required.</p>
            </div>
          </div>

          {/* Blocked state */}
          {hasOpenSession && (
            <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-warning/8 border border-warning/15">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Session already active</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Only one open session is allowed per outlet. Close or reconcile the current session before opening a new one.
                </p>
              </div>
            </div>
          )}

          {/* Details */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <Monitor className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Outlet</span>
                </div>
                <p className="text-sm font-medium text-foreground">{outletName}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Operator</span>
                </div>
                <p className="text-sm font-medium text-foreground">{operatorName}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Business Date</span>
                </div>
                <p className="text-sm font-medium text-foreground">{now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Current Time</span>
                </div>
                <p className="text-sm font-medium text-foreground">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note" className="text-sm font-medium text-foreground">Opening Note (optional)</Label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g., Starting morning shift"
                className="h-9"
              />
            </div>
          </div>

          <Button
            className="w-full h-10"
            disabled={hasOpenSession || !online || loading}
            onClick={handleOpen}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Opening Session…</>
            ) : (
              'Open Session'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
