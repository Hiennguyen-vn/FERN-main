import { chromium } from '@playwright/test';

const baseUrl = process.env.APP_URL || 'http://127.0.0.1:8082';
const username = process.env.APP_USER;
const password = process.env.APP_PASS;

const routes = [
  '/dashboard',
  '/inventory',
  '/procurement',
  '/catalog',
  '/reports',
  '/audit',
  '/iam',
  '/finance',
  '/hr',
  '/org/overview',
  '/settings',
  '/promotions',
  '/scheduling',
  '/workforce',
  '/crm',
  '/pos',
];

const results = [];

if (!username || !password) {
  throw new Error('APP_USER and APP_PASS must be set for playwright smoke checks');
}

function short(text, max = 160) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

async function safeStep(name, fn) {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), step: name };
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
  }
});

const pageErrors = [];
page.on('pageerror', (err) => {
  pageErrors.push(err.message);
});

const loginResult = await safeStep('login', async () => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  const allInputs = page.locator('input');
  const count = await allInputs.count();
  if (count < 2) {
    throw new Error('Login form inputs not found');
  }

  await allInputs.nth(0).fill(username);
  await allInputs.nth(1).fill(password);

  const submit = page.getByRole('button').filter({ hasText: /sign in|login|continue/i }).first();
  await submit.click();

  await page.waitForTimeout(600);
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  return {
    url: page.url(),
  };
});

results.push({ route: '/login', ...loginResult });

if (loginResult.ok) {
  for (const route of routes) {
    const result = await safeStep(`route:${route}`, async () => {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await page.waitForTimeout(500);

      const pageText = await page.locator('body').innerText();
      const hasServiceUnavailable = /Service temporarily unavailable|route unavailable|moduleName/i.test(pageText);
      const hasTable = (await page.locator('table tbody tr').count()) > 0;
      const hasPagination = (await page.locator('text=Page size').count()) > 0;
      const hasSearch = (await page.locator('input[placeholder*="Search" i]').count()) > 0;

      if (route === '/inventory') {
        const searchBox = page.locator('input[placeholder*="Search" i]').first();
        if (await searchBox.count()) {
          await searchBox.fill('1');
          await page.waitForTimeout(500);
        }
      }

      if (route === '/procurement' || route === '/catalog' || route === '/iam' || route === '/audit' || route === '/finance' || route === '/hr') {
        const refreshButton = page.getByRole('button').filter({ hasText: /refresh/i }).first();
        if (await refreshButton.count()) {
          await refreshButton.click();
          await page.waitForTimeout(500);
        }
      }

      return {
        url: page.url(),
        hasServiceUnavailable,
        hasTable,
        hasPagination,
        hasSearch,
        text: short(pageText),
      };
    });

    results.push({ route, ...result });
  }
}

await browser.close();

const summary = {
  baseUrl,
  loginUser: username,
  results,
  consoleErrors: consoleErrors.slice(0, 25),
  pageErrors: pageErrors.slice(0, 25),
};

console.log(JSON.stringify(summary, null, 2));
