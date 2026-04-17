import type {
  AuthScopeView,
  AuthUserListItem,
  ContractView,
  PayrollPeriodView,
  ScopeOutlet,
  ScopeRegion,
} from '@/api/fern-api';

export type PeriodWindowState = 'planned' | 'upcoming' | 'active' | 'ended';

export interface PayrollRosterEntry {
  userId: string;
  fullName: string;
  employeeCode?: string | null;
  preferredOutletId: string;
  outletLabels: string[];
  contract: ContractView;
}

function normalizeValue(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

export function inferPeriodWindowState(
  period?: Pick<PayrollPeriodView, 'startDate' | 'endDate'> | null,
  today = new Date().toISOString().slice(0, 10),
): PeriodWindowState {
  if (!period?.startDate || !period?.endDate) {
    return 'planned';
  }
  if (today < period.startDate) {
    return 'upcoming';
  }
  if (today > period.endDate) {
    return 'ended';
  }
  return 'active';
}

export function periodWindowBadgeClass(state: PeriodWindowState) {
  switch (state) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'ended':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    case 'upcoming':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

export function periodWindowLabel(state: PeriodWindowState) {
  switch (state) {
    case 'active':
      return 'Active window';
    case 'ended':
      return 'Ended window';
    case 'upcoming':
      return 'Upcoming window';
    default:
      return 'Planned window';
  }
}

export function collectRegionScopeIds(regions: ScopeRegion[], rootRegionId: string) {
  const root = normalizeValue(rootRegionId);
  if (!root) {
    return [];
  }

  const visited = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    regions.forEach((region) => {
      if (normalizeValue(region.parentRegionId) === current) {
        queue.push(region.id);
      }
    });
  }

  return [...visited];
}

export function buildContractDrivenPayrollRoster({
  users,
  scopes,
  contracts,
  outletsById,
  selectedRegionCodes,
}: {
  users: AuthUserListItem[];
  scopes: AuthScopeView[];
  contracts: ContractView[];
  outletsById: Map<string, ScopeOutlet>;
  selectedRegionCodes: string[];
}) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const scopesByUserId = new Map<string, AuthScopeView[]>();
  const latestActiveContractByUserId = new Map<string, ContractView>();
  const allowedRegionCodes = new Set(
    selectedRegionCodes.map((code) => normalizeValue(code)).filter(Boolean),
  );

  scopes.forEach((scope) => {
    const userId = normalizeValue(scope.userId);
    if (!userId) {
      return;
    }
    const bucket = scopesByUserId.get(userId) || [];
    bucket.push(scope);
    scopesByUserId.set(userId, bucket);
  });

  contracts.forEach((contract) => {
    const userId = normalizeValue(contract.userId);
    if (!userId) {
      return;
    }
    if (normalizeValue(contract.status).toLowerCase() !== 'active') {
      return;
    }

    const contractRegionCode = normalizeValue(contract.regionCode);
    if (
      allowedRegionCodes.size > 0 &&
      contractRegionCode &&
      !allowedRegionCodes.has(contractRegionCode)
    ) {
      return;
    }

    const current = latestActiveContractByUserId.get(userId);
    const currentStartDate = normalizeValue(current?.startDate);
    const candidateStartDate = normalizeValue(contract.startDate);
    if (!current || candidateStartDate > currentStartDate) {
      latestActiveContractByUserId.set(userId, contract);
    }
  });

  return ([...latestActiveContractByUserId.entries()]
    .map(([userId, contract]) => {
      const user = usersById.get(userId);
      const userScopes = scopesByUserId.get(userId) || [];
      const outletLabels = userScopes
        .map((scope) => {
          const outlet = outletsById.get(scope.outletId);
          return outlet ? `${outlet.code} · ${outlet.name}` : scope.outletName || `Outlet ${scope.outletId}`;
        })
        .filter((label, index, labels) => labels.indexOf(label) === index);

      // Use contract outlet as fallback when scopes are unavailable
      if (outletLabels.length === 0 && contract.outletId) {
        const outlet = outletsById.get(normalizeValue(contract.outletId));
        if (outlet) {
          outletLabels.push(`${outlet.code} · ${outlet.name}`);
        }
      }

      return {
        userId,
        fullName: user?.fullName || user?.username || `Employee ${userId.slice(-6)}`,
        employeeCode: user?.employeeCode,
        preferredOutletId: normalizeValue(contract.outletId) || normalizeValue(userScopes[0]?.outletId),
        outletLabels,
        contract,
      } satisfies PayrollRosterEntry;
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}
