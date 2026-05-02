import { useEffect, useMemo, useState } from 'react';
import {
  User,
  Mail,
  Phone,
  Lock,
  KeyRound,
  Save,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  IdCard,
  AtSign,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/auth/use-auth';
import { authApi } from '@/api/auth-api';
import { cn } from '@/lib/utils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s-]{4,29}$/;

function getInitials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status ?? '').toLowerCase();
  const tone =
    s === 'active'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
      : s === 'suspended' || s === 'disabled'
        ? 'bg-destructive/10 text-destructive border-destructive/20'
        : 'bg-muted text-muted-foreground border-border';
  const label = s === 'active' ? 'Active' : s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s === 'active' ? 'bg-emerald-500' : 'bg-current opacity-60')} />
      {label}
    </span>
  );
}

function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-sm text-foreground">{value || <span className="text-muted-foreground">—</span>}</p>
      </div>
    </div>
  );
}

function SectionHeader({ index, title, description }: { index: string; title: string; description: string }) {
  return (
    <div className="mb-6 flex items-baseline gap-4">
      <span className="font-mono text-xs text-muted-foreground">{index}</span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

interface ProfileErrors {
  fullName?: string;
  email?: string;
  phone?: string;
}

interface PasswordErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export function ProfilePage() {
  const { session, refreshSession } = useAuth();
  const { toast } = useToast();
  const user = session?.user;
  const token = session?.accessToken;

  const initials = useMemo(() => getInitials(user?.fullName), [user?.fullName]);

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.fullName, user?.email, user?.phone]);

  const profileDirty =
    (fullName ?? '').trim() !== (user?.fullName ?? '').trim() ||
    (email ?? '').trim() !== (user?.email ?? '').trim() ||
    (phone ?? '').trim() !== (user?.phone ?? '').trim();

  function validateProfile(): boolean {
    const errors: ProfileErrors = {};
    const name = fullName.trim();
    if (name.length < 2) errors.fullName = 'Full name must be at least 2 characters';
    if (email.trim() && !EMAIL_RE.test(email.trim())) errors.email = 'Invalid email';
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errors.phone = 'Invalid phone number';
    setProfileErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validatePassword(): boolean {
    const errors: PasswordErrors = {};
    if (!currentPassword) errors.currentPassword = 'Current password is required';
    if (newPassword.length < 8) errors.newPassword = 'New password must be at least 8 characters';
    if (newPassword && newPassword === currentPassword) {
      errors.newPassword = 'New password must differ from current password';
    }
    if (confirmPassword !== newPassword) errors.confirmPassword = 'Passwords do not match';
    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!validateProfile()) return;
    setSavingProfile(true);
    try {
      await authApi.updateMyProfile(token, {
        fullName: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      await refreshSession();
      toast({ title: 'Profile saved', description: 'Your personal information has been updated.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update profile.';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!validatePassword()) return;
    setSavingPassword(true);
    try {
      await authApi.changeMyPassword(token, { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password changed', description: 'Your new password has been saved.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to change password.';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSavingPassword(false);
    }
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">No active session.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6 lg:p-10">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Account</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">My Account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage your personal information and account security.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        <aside>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
                <div className="relative">
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
                    <span className="text-2xl font-semibold tracking-tight text-primary">{initials}</span>
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-emerald-500">
                    <ShieldCheck className="h-3 w-3 text-white" />
                  </div>
                </div>
                <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">{user.fullName}</h2>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">@{user.username}</p>
                <div className="mt-3">
                  <StatusBadge status={user.status} />
                </div>
              </div>

              <Separator />

              <div className="px-6 py-4">
                <MetaRow icon={IdCard} label="Employee Code" value={user.employeeCode} />
                <MetaRow icon={AtSign} label="Username" value={user.username} />
                <MetaRow icon={Mail} label="Email" value={user.email} />
                <MetaRow icon={Phone} label="Phone" value={user.phone} />
              </div>
            </CardContent>
          </Card>
        </aside>

        <main>
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:inline-grid">
              <TabsTrigger value="profile" className="gap-2">
                <User className="h-3.5 w-3.5" />
                Personal Info
              </TabsTrigger>
              <TabsTrigger value="password" className="gap-2">
                <KeyRound className="h-3.5 w-3.5" />
                Change Password
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-6">
              <Card>
                <CardHeader>
                  <SectionHeader
                    index="01"
                    title="Personal Information"
                    description="Update your full name, email, and contact phone."
                  />
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveProfile} className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label htmlFor="fullName" className="text-xs font-medium">
                          Full Name <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="fullName"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="pl-9"
                            placeholder="John Doe"
                            aria-invalid={Boolean(profileErrors.fullName)}
                          />
                        </div>
                        {profileErrors.fullName && (
                          <p className="text-xs text-destructive">{profileErrors.fullName}</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-xs font-medium">Email</Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-9"
                            placeholder="email@company.com"
                            aria-invalid={Boolean(profileErrors.email)}
                          />
                        </div>
                        {profileErrors.email && (
                          <p className="text-xs text-destructive">{profileErrors.email}</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="phone" className="text-xs font-medium">Phone</Label>
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="phone"
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="pl-9"
                            placeholder="+84 90 123 4567"
                            aria-invalid={Boolean(profileErrors.phone)}
                          />
                        </div>
                        {profileErrors.phone && (
                          <p className="text-xs text-destructive">{profileErrors.phone}</p>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        Username and employee code cannot be changed — contact your administrator.
                      </p>
                      <Button type="submit" disabled={savingProfile || !profileDirty} className="gap-2">
                        {savingProfile ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Save Changes
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="password" className="mt-6">
              <Card>
                <CardHeader>
                  <SectionHeader
                    index="02"
                    title="Change Password"
                    description="New password must differ from current and be at least 8 characters."
                  />
                </CardHeader>
                <CardContent>
                  <Alert className="mb-6 border-amber-500/20 bg-amber-500/5">
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                    <AlertDescription className="text-xs text-foreground">
                      After changing your password, other active sessions may require re-login.
                    </AlertDescription>
                  </Alert>

                  <form onSubmit={handleChangePassword} className="space-y-5">
                    <PasswordField
                      id="currentPassword"
                      label="Current Password"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      visible={showCurrent}
                      onToggle={() => setShowCurrent((v) => !v)}
                      error={passwordErrors.currentPassword}
                      autoComplete="current-password"
                      required
                    />
                    <PasswordField
                      id="newPassword"
                      label="New Password"
                      value={newPassword}
                      onChange={setNewPassword}
                      visible={showNew}
                      onToggle={() => setShowNew((v) => !v)}
                      error={passwordErrors.newPassword}
                      autoComplete="new-password"
                      required
                    />
                    <PasswordField
                      id="confirmPassword"
                      label="Confirm New Password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      visible={showConfirm}
                      onToggle={() => setShowConfirm((v) => !v)}
                      error={passwordErrors.confirmPassword}
                      autoComplete="new-password"
                      required
                    />

                    <Separator />

                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingPassword} className="gap-2">
                        {savingPassword ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                        Update Password
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  error?: string;
  autoComplete?: string;
  required?: boolean;
}

function PasswordField({ id, label, value, onChange, visible, onToggle, error, autoComplete, required }: PasswordFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="pl-9 pr-10"
          aria-invalid={Boolean(error)}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
