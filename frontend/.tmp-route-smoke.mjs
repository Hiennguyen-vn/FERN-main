import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8082';
const ROUTES = [
  '/dashboard',
  '/pos',
  '/inventory',
  '/procurement',
  '/catalog',
  '/reports',
  '/audit',
  '/iam',
  '/finance',
  '/hr',
  '/settings',
  '/promotions',
  '/scheduling',
  '/workforce',
  '/crm',
];

function now() {
  return new Date().toISOString();
}

async function safeClick(page, role, name) {
  const locator = page.getByRole(role, { name });
  if (await locator.count()) {
    await locator.first().click({ timeout: 3000 });
    return true;
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const report = {
  startedAt: now(),
  base: BASE,
  login: null,
  routes: {},
  actions: {},
  endedAt: null,
};

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', 'admin');
  await page.fill('#password', '123123123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|shell)/, { timeout: 20000 });
  await page.waitForTimeout(1200);

  report.login = {
    ok: !page.url().includes('/login'),
    url: page.url(),
  };

  for (const route of ROUTES) {
    const started = Date.now();
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const url = page.url();
      const redirectedToLogin = /\/login/.test(url);
      const hasMain = (await page.locator('main').count()) > 0;
      report.routes[route] = {
        ok: !redirectedToLogin && hasMain,
        url,
        redirectedToLogin,
        hasMain,
        ms: Date.now() - started,
      };
    } catch (error) {
      report.routes[route] = {
        ok: false,
        url: page.url(),
        redirectedToLogin: page.url().includes('/login'),
        hasMain: false,
        ms: Date.now() - started,
        note: String(error?.message || error),
      };
    }
  }

  try {
    await page.goto(`${BASE}/iam`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const clickedUsers = await safeClick(page, 'button', 'Users');
    const clickedScopes = await safeClick(page, 'button', 'Scopes');
    const clickedOverrides = await safeClick(page, 'button', 'Overrides');
    report.actions.iam = { ok: clickedUsers || clickedScopes || clickedOverrides, clickedUsers, clickedScopes, clickedOverrides };
  } catch (e) {
    report.actions.iam = { ok: false, error: String(e?.message || e) };
  }

  try {
    await page.goto(`${BASE}/audit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const clickedSecurity = await safeClick(page, 'button', 'Security Events');
    await page.waitForTimeout(400);
    const clickedTraces = await safeClick(page, 'button', 'Request Traces');
    report.actions.audit = { ok: clickedSecurity || clickedTraces, clickedSecurity, clickedTraces };
  } catch (e) {
    report.actions.audit = { ok: false, error: String(e?.message || e) };
  }

  try {
    await page.goto(`${BASE}/crm`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const search = page.getByPlaceholder('Search customers');
    let ok = false;
    if (await search.count()) {
      await search.fill('a');
      await search.press('Enter');
      await page.waitForTimeout(500);
      ok = true;
    }
    report.actions.crm = { ok };
  } catch (e) {
    report.actions.crm = { ok: false, error: String(e?.message || e) };
  }

  try {
    await page.goto(`${BASE}/catalog`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const clickedPricing = await safeClick(page, 'button', 'Pricing & Promos');
    await page.waitForTimeout(500);
    const hasPriceTable =
      (await page.locator('text=No prices found for this outlet').count()) > 0 ||
      (await page.locator('th:has-text("Price")').count()) > 0;
    report.actions.catalogPricing = { ok: clickedPricing && hasPriceTable, clickedPricing, hasPriceTable };
  } catch (e) {
    report.actions.catalogPricing = { ok: false, error: String(e?.message || e) };
  }

  try {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const clickedTables = await safeClick(page, 'button', 'Tables');
    await page.waitForTimeout(500);
    const hasTablesSurface =
      (await page.locator('text=Ordering Tables').count()) > 0 ||
      (await page.locator('text=No tables found').count()) > 0;
    report.actions.posTables = { ok: clickedTables && hasTablesSurface, clickedTables, hasTablesSurface };
  } catch (e) {
    report.actions.posTables = { ok: false, error: String(e?.message || e) };
  }
} catch (error) {
  report.login = {
    ok: false,
    url: page.url(),
    error: String(error?.message || error),
  };
} finally {
  report.endedAt = now();
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
