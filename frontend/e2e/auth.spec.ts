import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Authentication', () => {
  test('shows login page when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
    await expect(page.locator('#email')).toBeVisible();
  });

  test('logs in with valid credentials and redirects to dashboard', async ({ page }) => {
    await login(page);
    // Login redirects to /shell → /dashboard
    expect(page.url()).toMatch(/\/(dashboard|shell)/);
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText(/dashboard|revenue|outlet|order/i);
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#email').fill('baduser');
    await page.locator('#password').fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForTimeout(3000);
    // Should stay on login page
    expect(page.url()).toContain('/login');
  });
});
