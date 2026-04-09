import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:8081';
const routes = [
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
];

const result = {
  login: { ok: false, url: '', error: '' },
  routes: [],
  checks: {
    iam: { ok: false, notes: [] },
    audit: { ok: false, notes: [] },
    crm: { ok: false, notes: [] },
    pos: { ok: false, notes: [] },
  },
  jsErrors: [],
  apiFailures: [],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.route('**/api/**', async (route) => {
  const headers = { ...route.request().headers() };
  delete headers.origin;
  await route.continue({ headers });
});

page.on('pageerror', (err) => {
  result.jsErrors.push(String(err));
});

page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('/api/')) return;
  if (res.status() >= 400) {
    let body = '';
    try { body = await res.text(); } catch {}
    result.apiFailures.push(`${res.status()} ${url} ${body.slice(0, 180)}`);
  }
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('#email', 'admin');
  await page.fill('#password', '123123123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => ['/dashboard', '/shell'].includes(u.pathname), { timeout: 30000 });
  if (new URL(page.url()).pathname === '/shell') {
    await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 15000 });
  }
  result.login.ok = true;
  result.login.url = page.url();
} catch (error) {
  result.login.error = String(error);
}

for (const path of routes) {
  const routeResult = { path, ok: false, url: '', marker: '', error: '' };
  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    routeResult.ok = new URL(page.url()).pathname === path;
    routeResult.url = page.url();
    const marker = await page.locator('h1, h2').first().textContent().catch(() => '');
    routeResult.marker = (marker || '').trim();
    if (!routeResult.ok) {
      routeResult.error = `redirected to ${new URL(page.url()).pathname}`;
    }
  } catch (error) {
    routeResult.error = String(error);
  }
  result.routes.push(routeResult);
}

try {
  await page.goto(`${baseUrl}/iam`, { waitUntil: 'networkidle', timeout: 30000 });
  for (const tab of ['Users', 'Scopes', 'Overrides']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).click({ timeout: 10000 });
    await page.waitForTimeout(700);
    const errText = await page.locator('text=Unable to load').count();
    result.checks.iam.notes.push(`${tab}: ${errText > 0 ? 'load-error-visible' : 'loaded'}`);
  }
  result.checks.iam.ok = !result.checks.iam.notes.some((n) => n.includes('load-error-visible'));
} catch (error) {
  result.checks.iam.notes.push(`exception: ${String(error)}`);
}

try {
  await page.goto(`${baseUrl}/audit`, { waitUntil: 'networkidle', timeout: 30000 });
  for (const tab of ['Security Events', 'Request Traces']) {
    await page.getByRole('button', { name: new RegExp(tab, 'i') }).click({ timeout: 10000 });
    await page.waitForTimeout(700);
    const errText = await page.locator('text=Unable to load').count();
    result.checks.audit.notes.push(`${tab}: ${errText > 0 ? 'load-error-visible' : 'loaded'}`);
  }
  result.checks.audit.ok = !result.checks.audit.notes.some((n) => n.includes('load-error-visible'));
} catch (error) {
  result.checks.audit.notes.push(`exception: ${String(error)}`);
}

try {
  await page.goto(`${baseUrl}/crm`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(700);
  const errText = await page.locator('text=Unable to load customers').count();
  const titleText = await page.locator('text=CRM & Loyalty').count();
  result.checks.crm.notes.push(`crm-title-visible=${titleText > 0}`);
  result.checks.crm.notes.push(`crm-load-error-visible=${errText > 0}`);
  result.checks.crm.ok = titleText > 0 && errText === 0;
} catch (error) {
  result.checks.crm.notes.push(`exception: ${String(error)}`);
}

try {
  await page.goto(`${baseUrl}/pos`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: /customers/i }).click({ timeout: 10000 });
  await page.waitForTimeout(700);
  const customersTitle = await page.locator('text=Customer References').count();
  const customersErr = await page.locator('text=Unable to load customers').count();
  result.checks.pos.notes.push(`customers-screen=${customersTitle > 0}`);
  result.checks.pos.notes.push(`customers-load-error-visible=${customersErr > 0}`);

  await page.getByRole('button', { name: /^Back$/i }).first().click({ timeout: 10000 });
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /tables/i }).click({ timeout: 10000 });
  await page.waitForTimeout(700);
  const tablesTitle = await page.locator('text=Ordering Tables').count();
  const tablesErr = await page.locator('text=Unable to load ordering tables').count();
  result.checks.pos.notes.push(`tables-screen=${tablesTitle > 0}`);
  result.checks.pos.notes.push(`tables-load-error-visible=${tablesErr > 0}`);

  result.checks.pos.ok = customersTitle > 0 && tablesTitle > 0 && customersErr === 0 && tablesErr === 0;
} catch (error) {
  result.checks.pos.notes.push(`exception: ${String(error)}`);
}

await browser.close();
console.log(JSON.stringify(result, null, 2));
