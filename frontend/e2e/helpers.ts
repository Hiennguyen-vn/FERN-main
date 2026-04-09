import { type Page, expect } from '@playwright/test';

function requireCredential(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be set for Playwright login flows`);
  }
  return normalized;
}

/** Log in via the UI and wait for the dashboard redirect. */
export async function login(
  page: Page,
  username = process.env.E2E_USERNAME || process.env.APP_USER,
  password = process.env.E2E_PASSWORD || process.env.APP_PASS,
) {
  const resolvedUsername = requireCredential(username, 'E2E_USERNAME or APP_USER');
  const resolvedPassword = requireCredential(password, 'E2E_PASSWORD or APP_PASS');
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  // Login form uses id="email" for username and id="password" for password
  await page.locator('#email').fill(resolvedUsername);
  await page.locator('#password').fill(resolvedPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait for redirect away from login (login → /shell → /dashboard)
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 });
  // Wait for final redirect to settle
  await page.waitForLoadState('domcontentloaded');
}

/** Assert the page does NOT show a white-screen crash. */
export async function assertNoCrash(page: Page) {
  await page.waitForTimeout(2000);
  const body = page.locator('body');
  await expect(body).not.toBeEmpty();
  const textContent = await body.innerText();
  expect(textContent.trim().length).toBeGreaterThan(10);
}

/** Navigate to a route while authenticated. */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}
