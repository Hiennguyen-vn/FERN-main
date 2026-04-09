export * from '@/api/auth-api';
export * from '@/api/gateway-api';
export * from '@/api/org-api';
export * from '@/api/product-api';
export * from '@/api/inventory-api';
export * from '@/api/procurement-api';
export * from '@/api/reports-api';
export * from '@/api/sales-api';
export * from '@/api/payroll-api';
export * from '@/api/finance-api';
export * from '@/api/audit-api';
export * from '@/api/crm-api';
export * from '@/api/hr-api';

export { authApi } from '@/api/auth-api';
export { gatewayApi } from '@/api/gateway-api';
export { orgApi } from '@/api/org-api';
export { productApi } from '@/api/product-api';
export { inventoryApi } from '@/api/inventory-api';
export { procurementApi } from '@/api/procurement-api';
export { reportsApi } from '@/api/reports-api';
export { salesApi } from '@/api/sales-api';
export { payrollApi } from '@/api/payroll-api';
export { financeApi } from '@/api/finance-api';
export { auditApi } from '@/api/audit-api';
export { crmApi } from '@/api/crm-api';
export { hrApi } from '@/api/hr-api';

import type { OrgHierarchy } from '@/api/org-api';

export function pickDefaultOutletId(hierarchy: OrgHierarchy, rolesByOutlet: Record<string, string[]>) {
  const roleOutletIds = Object.keys(rolesByOutlet || {});
  if (roleOutletIds.length > 0) return roleOutletIds[0];
  if (hierarchy.outlets.length > 0) return hierarchy.outlets[0].id;
  return '';
}
