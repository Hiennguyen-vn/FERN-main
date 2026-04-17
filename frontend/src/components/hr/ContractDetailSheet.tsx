import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  contractBadgeClass,
  formatHrEnumLabel,
  getHrUserDisplay,
  shortHrRef,
} from '@/components/hr/hr-display';
import type { AuthUserListItem, ContractView } from '@/api/fern-api';
import { RefreshCw, Ban, Calendar, Briefcase, CreditCard, MapPin, Pencil, GitBranch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ContractEditDialog } from '@/components/hr/ContractEditDialog';
import { ContractTimeline } from '@/components/hr/ContractTimeline';
import { SalaryBreakdownPanel } from '@/components/hr/SalaryBreakdownPanel';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrency(value: unknown, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ContractDetailSheetProps {
  contract: ContractView | null;
  allContracts: ContractView[];
  usersById: Map<string, AuthUserListItem>;
  token: string;
  users: AuthUserListItem[];
  onClose: () => void;
  onTerminate: (contractId: string) => void;
  onRenew: (contract: ContractView) => void;
  onUpdated: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContractDetailSheet({
  contract,
  allContracts,
  usersById,
  token,
  users,
  onClose,
  onTerminate,
  onRenew,
  onUpdated,
}: ContractDetailSheetProps) {
  const [editDialog, setEditDialog] = useState(false);

  const userContracts = useMemo(() => {
    if (!contract?.userId) return [];
    return allContracts.filter((c) => c.userId === contract.userId);
  }, [allContracts, contract?.userId]);
  if (!contract) {
    return (
      <Sheet open={false} onOpenChange={() => onClose()}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Contract Details</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const status = String(contract.status || 'unknown').toLowerCase();
  const userDisplay = getHrUserDisplay(usersById, contract.userId);
  const isActive = status === 'active' || status === 'draft';

  return (
    <Sheet open={!!contract} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">{userDisplay.primary}</SheetTitle>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', contractBadgeClass(status))}>
              {formatHrEnumLabel(status)}
            </span>
          </div>
          <SheetDescription>
            {shortHrRef(contract.id)} {userDisplay.secondary ? `· ${userDisplay.secondary}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Terms section */}
          <div className="surface-elevated p-4 space-y-1">
            <div className="flex items-center gap-1.5 mb-3">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Employment Terms</span>
            </div>
            {([
              { label: 'Employment Type', value: formatHrEnumLabel(contract.employmentType) },
              { label: 'Salary Type', value: formatHrEnumLabel(contract.salaryType) },
              { label: 'Base Salary', value: formatCurrency(contract.baseSalary, String(contract.currencyCode || 'USD')) },
              { label: 'Currency', value: String(contract.currencyCode || '—').toUpperCase() },
            ]).map((item) => (
              <div key={item.label} className="flex justify-between py-1.5">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm font-medium">{item.value}</span>
              </div>
            ))}
          </div>

          {/* Dates section */}
          <div className="surface-elevated p-4 space-y-1">
            <div className="flex items-center gap-1.5 mb-3">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contract Period</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sm text-muted-foreground">Start Date</span>
              <span className="text-sm font-medium">{formatDate(contract.startDate)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sm text-muted-foreground">End Date</span>
              <span className="text-sm font-medium">{formatDate(contract.endDate)}</span>
            </div>
            {contract.endDate && isActive ? (
              <div className="mt-2">
                {(() => {
                  const daysLeft = Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000);
                  if (daysLeft <= 0) return <p className="text-xs text-destructive font-medium">Contract has expired</p>;
                  if (daysLeft <= 30) return <p className="text-xs text-amber-600 font-medium">Expires in {daysLeft} days</p>;
                  return <p className="text-xs text-muted-foreground">{daysLeft} days remaining</p>;
                })()}
              </div>
            ) : null}
          </div>

          {/* Payment section */}
          <div className="surface-elevated p-4 space-y-1">
            <div className="flex items-center gap-1.5 mb-3">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Payment Details</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sm text-muted-foreground">Tax Code</span>
              <span className="text-sm font-medium">{String(contract.taxCode || '—')}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sm text-muted-foreground">Bank Account</span>
              <span className="text-sm font-medium">{String(contract.bankAccount || '—')}</span>
            </div>
          </div>

          {/* Salary breakdown */}
          <SalaryBreakdownPanel contract={contract} />

          {/* Region section */}
          {contract.regionCode ? (
            <div className="surface-elevated p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Region</span>
              </div>
              <p className="text-sm font-medium">{String(contract.regionCode)}</p>
            </div>
          ) : null}

          {/* Timeline */}
          {userContracts.length > 1 ? (
            <div className="surface-elevated p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contract History</span>
              </div>
              <ContractTimeline contracts={userContracts} />
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {isActive ? (
              <>
                <button
                  onClick={() => setEditDialog(true)}
                  className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent flex items-center justify-center gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => onRenew(contract)}
                  className="flex-1 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Renew
                </button>
                <button
                  onClick={() => onTerminate(String(contract.id))}
                  className="h-9 rounded-md border border-destructive/50 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5"
                >
                  <Ban className="h-3.5 w-3.5" /> Terminate
                </button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">This contract is {formatHrEnumLabel(status).toLowerCase()}. No further actions available.</p>
            )}
          </div>
        </div>

        {editDialog ? (
          <ContractEditDialog
            contract={contract}
            token={token}
            users={users}
            onClose={() => setEditDialog(false)}
            onSaved={() => {
              setEditDialog(false);
              onUpdated();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
