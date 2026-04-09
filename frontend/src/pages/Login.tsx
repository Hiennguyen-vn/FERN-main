import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthErrorType } from '@/types/shell';
import {
  AlertTriangle,
  Lock,
  ShieldOff,
  ServerCrash,
  Loader2,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';

const AUTH_ERROR_MESSAGES: Record<AuthErrorType, { title: string; message: string; icon: React.ReactNode }> = {
  invalid_credentials: {
    title: 'Invalid credentials',
    message: 'The username or password you entered is incorrect. Please try again.',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  account_locked: {
    title: 'Account locked',
    message: 'Your account has been temporarily locked due to multiple failed sign-in attempts. Please contact your administrator.',
    icon: <Lock className="h-4 w-4" />,
  },
  account_suspended: {
    title: 'Account suspended',
    message: 'Your account has been suspended. Please reach out to your organization administrator for assistance.',
    icon: <ShieldOff className="h-4 w-4" />,
  },
  gateway_misconfigured: {
    title: 'Gateway route unavailable',
    message: 'Login endpoint was not found from this frontend origin. Check Vite proxy settings or set VITE_API_BASE_URL to the gateway.',
    icon: <ServerCrash className="h-4 w-4" />,
  },
  service_unavailable: {
    title: 'Authentication service unavailable',
    message: 'The authentication service is currently unreachable. This is a temporary infrastructure issue — please try again shortly.',
    icon: <ServerCrash className="h-4 w-4" />,
  },
  branch_blocked: {
    title: 'Environment startup pending',
    message: 'Authentication is temporarily unavailable because required backend services are still starting or blocked in this environment.',
    icon: <ServerCrash className="h-4 w-4" />,
  },
};

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorType | null>(null);
  const [showBranchBlocked, setShowBranchBlocked] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const run = async () => {
      setLoading(true);
      setAuthError(null);
      if (!email || !password) {
        setAuthError('invalid_credentials');
        setLoading(false);
        return;
      }

      try {
        await login(email.trim(), password);
        navigate('/shell');
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            setAuthError('invalid_credentials');
          } else if (error.status === 403) {
            setAuthError('account_suspended');
          } else if (error.status === 404) {
            setAuthError('gateway_misconfigured');
          } else {
            setAuthError('service_unavailable');
          }
          return;
        }
        setAuthError('service_unavailable');
      } finally {
        setLoading(false);
      }
    };

    void run();
  };

  const errorInfo = authError ? AUTH_ERROR_MESSAGES[authError] : null;
  const branchInfo = AUTH_ERROR_MESSAGES.branch_blocked;

  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand / illustration */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12"
        style={{ background: 'hsl(var(--login-panel))' }}
      >
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">O</span>
            </div>
            <span className="text-lg font-semibold" style={{ color: 'hsl(var(--login-panel-foreground))' }}>
              OpsCenter
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'hsl(var(--sidebar-muted))' }}>
            Multi-Outlet F&B Operations Platform
          </p>
        </div>

        <div className="space-y-8">
          <div className="space-y-6">
            {[
              { label: 'Outlet Operations', desc: 'POS, inventory, and daily ops in one place' },
              { label: 'Regional Oversight', desc: 'Cross-outlet visibility and approvals' },
              { label: 'Finance & Procurement', desc: 'End-to-end spend and supply chain control' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'hsl(var(--sidebar-accent))' }}>
                  <ChevronRight className="h-4 w-4" style={{ color: 'hsl(var(--login-accent))' }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'hsl(var(--login-panel-foreground))' }}>
                    {item.label}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--sidebar-muted))' }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs" style={{ color: 'hsl(var(--sidebar-muted))' }}>
          © 2026 OpsCenter · Enterprise Platform v2.1
        </p>
      </div>

      {/* Right panel — auth form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">O</span>
            </div>
            <span className="text-lg font-semibold text-foreground">OpsCenter</span>
          </div>

          <div>
            <h1 className="text-xl font-semibold text-foreground">Sign in to your account</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter your credentials to access the platform
            </p>
          </div>

          {/* Branch blocked banner */}
          {showBranchBlocked && (
            <div className="permission-banner permission-banner-unavailable animate-fade-in">
              <ServerCrash className="h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">{branchInfo.title}</p>
                <p className="text-xs mt-0.5 text-muted-foreground">{branchInfo.message}</p>
              </div>
            </div>
          )}

          {/* Auth error */}
          {errorInfo && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5 animate-fade-in">
              <span className="text-destructive mt-0.5">{errorInfo.icon}</span>
              <div>
                <p className="font-medium text-sm text-foreground">{errorInfo.title}</p>
                <p className="text-xs mt-0.5 text-muted-foreground">{errorInfo.message}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Username or email
              </Label>
              <Input
                id="email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-10"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="pt-4 border-t">
            <button
              type="button"
              onClick={() => setShowBranchBlocked(!showBranchBlocked)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showBranchBlocked ? 'Hide' : 'Show'} environment status
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
