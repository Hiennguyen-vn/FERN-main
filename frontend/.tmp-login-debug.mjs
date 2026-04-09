import { chromium } from 'playwright';

const pageLogs = { req: [], res: [], errorText: '', finalUrl: '' };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('request', (req) => {
  if (req.url().includes('/api/v1/auth')) {
    pageLogs.req.push(`${req.method()} ${req.url()} body=${req.postData() || ''}`);
  }
});
page.on('response', async (res) => {
  if (res.url().includes('/api/v1/auth')) {
    let body = '';
    try { body = await res.text(); } catch {}
    pageLogs.res.push(`${res.status()} ${res.url()} body=${body.slice(0, 300)}`);
  }
});

await page.goto('http://127.0.0.1:8081/login', { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'admin');
await page.fill('#password', '123123123');
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForTimeout(5000);

pageLogs.finalUrl = page.url();
const err = await page.locator('div:has-text("Invalid credentials"), div:has-text("Authentication service unavailable"), div:has-text("Gateway route unavailable")').first().textContent().catch(() => '');
pageLogs.errorText = (err || '').trim();

await browser.close();
console.log(JSON.stringify(pageLogs, null, 2));
