import { test, expect } from '@playwright/test';
import { login, assertNoCrash, navigateTo } from './helpers';

// All protected routes and a human-readable label
const ROUTES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/pos', 'POS'],
  ['/inventory', 'Inventory'],
  ['/procurement', 'Procurement'],
  ['/catalog', 'Catalog'],
  ['/reports', 'Reports'],
  ['/audit', 'Audit'],
  ['/iam', 'IAM'],
  ['/finance', 'Finance'],
  ['/hr', 'HR'],
  ['/org/overview', 'Organization'],
  ['/settings', 'Settings'],
  ['/crm', 'CRM'],
  ['/promotions', 'Promotions'],
  ['/scheduling', 'Scheduling'],
  ['/workforce', 'Workforce'],
];

test.describe('Route smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const [path, label] of ROUTES) {
    test(`${label} (${path}) renders without crash`, async ({ page }) => {
      await navigateTo(page, path);
      await assertNoCrash(page);
    });
  }
});
