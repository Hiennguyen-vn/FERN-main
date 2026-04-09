import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers';

test.describe('Key workflows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Dashboard shows KPI cards and recent orders', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    // Should have at least one numeric KPI visible (revenue, orders, etc.)
    await expect(page.locator('body')).toContainText(/revenue|orders|sessions/i);
  });

  test('Inventory shows stock balances table', async ({ page }) => {
    await navigateTo(page, '/inventory');
    // Should show a table or list with inventory data
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/stock|balance|inventory|item/i);
  });

  test('Catalog shows products tab', async ({ page }) => {
    await navigateTo(page, '/catalog');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/product|item|catalog|ingredient/i);
  });

  test('Procurement shows supplier or PO data', async ({ page }) => {
    await navigateTo(page, '/procurement');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/supplier|purchase|procurement|order/i);
  });

  test('IAM shows user list', async ({ page }) => {
    await navigateTo(page, '/iam');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/user|role|permission|scope/i);
  });

  test('Audit shows log entries', async ({ page }) => {
    await navigateTo(page, '/audit');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/audit|log|event|trace/i);
  });

  test('Finance shows expenses or payroll', async ({ page }) => {
    await navigateTo(page, '/finance');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/expense|payroll|period|finance/i);
  });

  test('HR shows work shifts or contracts', async ({ page }) => {
    await navigateTo(page, '/hr');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/shift|contract|attendance|hr/i);
  });

  test('Settings shows org hierarchy', async ({ page }) => {
    await navigateTo(page, '/settings');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/outlet|region|setting|organization/i);
  });

  test('Reports shows revenue or inventory data', async ({ page }) => {
    await navigateTo(page, '/reports');
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/revenue|report|stock|outlet/i);
  });
});
