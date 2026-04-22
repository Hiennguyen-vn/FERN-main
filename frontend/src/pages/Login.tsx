import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/use-auth';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import type { AuthErrorType } from '@/types/shell';
import {
  AlertTriangle,
  Lock,
  ShieldOff,
  ServerCrash,
  Loader2,
  Eye,
  EyeOff,
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6 bg-background">
      {/* Decorative background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 20% 10%, hsl(var(--primary) / 0.12), transparent 60%),' +
            'radial-gradient(ellipse 50% 40% at 85% 90%, hsl(var(--scope-region) / 0.10), transparent 60%),' +
            'linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--surface-2)) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl -z-10"
        style={{ background: 'hsl(var(--primary) / 0.15)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl -z-10"
        style={{ background: 'hsl(var(--scope-region) / 0.12)' }}
      />

      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <img src="/brand-mark.svg" alt="FERN" width={56} height={56} className="h-14 w-14 rounded-2xl shadow-lg" />
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">FERN</h1>
            <p className="text-xs mt-1 text-muted-foreground">
              Multi-Outlet F&B Operations Platform
            </p>
          </div>
        </div>

        {/* Card */}
        <Card
          className="border-border/60 backdrop-blur-sm"
          style={{ boxShadow: 'var(--shadow-xl)', background: 'hsl(var(--card) / 0.85)' }}
        >
          <CardContent className="p-6 sm:p-8 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sign in to your account</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enter your credentials to access the platform
              </p>
            </div>

            {showBranchBlocked && (
              <div className="permission-banner permission-banner-unavailable animate-fade-in">
                <ServerCrash className="h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">{branchInfo.title}</p>
                  <p className="text-xs mt-0.5 text-muted-foreground">{branchInfo.message}</p>
                </div>
              </div>
            )}

            {errorInfo && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5 animate-fade-in">
                <span className="text-destructive mt-0.5">{errorInfo.icon}</span>
                <div>
                  <p className="font-medium text-sm text-foreground">{errorInfo.title}</p>
                  <p className="text-xs mt-0.5 text-muted-foreground">{errorInfo.message}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="h-11"
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">
                    Password
                  </Label>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-11 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full h-11 font-medium" disabled={loading}>
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

            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setShowBranchBlocked(!showBranchBlocked)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showBranchBlocked ? 'Hide' : 'Show'} environment status
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 FERN · Enterprise Platform v2.1
        </p>
      </div>
    </div>
  );
}
