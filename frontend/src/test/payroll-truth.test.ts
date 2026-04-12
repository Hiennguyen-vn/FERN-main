import { describe, expect, it } from 'vitest';
import {
  buildContractDrivenPayrollRoster,
  inferPeriodWindowState,
  periodWindowLabel,
} from '@/components/payroll/payroll-truth';

describe('payroll truth helpers', () => {
  it('derives payroll window state from dates without inventing persisted status', () => {
    expect(
      inferPeriodWindowState({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      }, '2026-03-30'),
    ).toBe('upcoming');
    expect(
      inferPeriodWindowState({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      }, '2026-04-10'),
    ).toBe('active');
    expect(
      inferPeriodWindowState({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      }, '2026-05-02'),
    ).toBe('ended');
    expect(periodWindowLabel('ended')).toBe('Ended window');
  });

  it('builds a contract-driven payroll roster and excludes users without active contracts', () => {
    const users = [
      {
        id: 'u-1',
        username: 'alice',
        fullName: 'Alice Nguyen',
        employeeCode: 'EMP-001',
      },
      {
        id: 'u-2',
        username: 'bob',
        fullName: 'Bob Tran',
        employeeCode: 'EMP-002',
      },
      {
        id: 'u-3',
        username: 'charlie',
        fullName: 'Charlie Pham',
        employeeCode: 'EMP-003',
      },
    ];

    const scopes = [
      {
        userId: 'u-1',
        username: 'alice',
        fullName: 'Alice Nguyen',
        outletId: 'o-1',
        outletCode: 'OUT-001',
        outletName: 'Downtown',
        roles: ['outlet_manager'],
        permissions: [] as string[],
      },
      {
        userId: 'u-2',
        username: 'bob',
        fullName: 'Bob Tran',
        outletId: 'o-2',
        outletCode: 'OUT-002',
        outletName: 'Riverside',
        roles: ['cashier'],
        permissions: [] as string[],
      },
      {
        userId: 'u-3',
        username: 'charlie',
        fullName: 'Charlie Pham',
        outletId: 'o-3',
        outletCode: 'OUT-003',
        outletName: 'Airport',
        roles: ['cashier'],
        permissions: [] as string[],
      },
    ];

    const contracts = [
      {
        id: 'c-older',
        userId: 'u-1',
        outletId: 'o-1',
        regionCode: 'VN-HCM',
        status: 'active',
        startDate: '2026-03-01',
        baseSalary: 20000,
        currencyCode: 'VND',
      },
      {
        id: 'c-newer',
        userId: 'u-1',
        outletId: 'o-1',
        regionCode: 'VN-HCM',
        status: 'active',
        startDate: '2026-04-01',
        baseSalary: 24000,
        currencyCode: 'VND',
      },
      {
        id: 'c-other-region',
        userId: 'u-2',
        outletId: 'o-2',
        regionCode: 'VN-DN',
        status: 'active',
        startDate: '2026-04-01',
        baseSalary: 18000,
        currencyCode: 'VND',
      },
      {
        id: 'c-terminated',
        userId: 'u-3',
        outletId: 'o-3',
        regionCode: 'VN-HCM',
        status: 'terminated',
        startDate: '2026-04-01',
        baseSalary: 16000,
        currencyCode: 'VND',
      },
    ];

    const outletsById = new Map([
      ['o-1', { id: 'o-1', regionId: 'r-1', code: 'OUT-001', name: 'Downtown', status: 'active' }],
      ['o-2', { id: 'o-2', regionId: 'r-1', code: 'OUT-002', name: 'Riverside', status: 'active' }],
      ['o-3', { id: 'o-3', regionId: 'r-1', code: 'OUT-003', name: 'Airport', status: 'active' }],
    ]);

    const roster = buildContractDrivenPayrollRoster({
      users,
      scopes,
      contracts,
      outletsById,
      selectedRegionCodes: ['VN-HCM'],
    });

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      userId: 'u-1',
      fullName: 'Alice Nguyen',
      employeeCode: 'EMP-001',
      preferredOutletId: 'o-1',
    });
    expect(roster[0].contract.id).toBe('c-newer');
    expect(roster[0].outletLabels).toEqual(['OUT-001 · Downtown']);
  });
});
