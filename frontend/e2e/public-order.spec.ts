import { test, expect } from '@playwright/test';

const PUBLIC_TABLE_TOKEN = process.env.E2E_PUBLIC_TABLE_TOKEN || 'tbl_hcm1_u7k29q';

test.describe('Public ordering route', () => {
  test('renders without auth and loads the table menu', async ({ page }) => {
    await page.goto(`/order/${PUBLIC_TABLE_TOKEN}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Saigon Central Outlet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Quick add|Add to cart/i }).first()).toBeVisible();
  });

  test('submits against the live public backend and surfaces the real result', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/order/${PUBLIC_TABLE_TOKEN}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const addButtons = page.getByRole('button', { name: /Quick add|Add to cart/i });
    await expect(addButtons.first()).toBeVisible();
    await addButtons.first().click();

    await page.getByRole('button', { name: /Send order/i }).click();
    await page.waitForFunction(() => (
      window.location.search.includes('order=')
      || document.body.innerText.includes('One or more items are unavailable')
    ), undefined, { timeout: 15_000 });

    if (page.url().includes('?order=')) {
      await expect(page.getByText(/Order received by the kitchen/i)).toBeVisible();
      const receiptUrl = page.url();
      await page.reload();
      await expect(page).toHaveURL(receiptUrl);
      await expect(page.getByText(/Order received by the kitchen/i)).toBeVisible();
      return;
    }

    await expect(page.getByText(/One or more items are unavailable or exceed the stock available for this table/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Send order/i })).toBeVisible();
  });

  test('submits from mobile cart sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/order/${PUBLIC_TABLE_TOKEN}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const addButton = page.getByRole('button', { name: /Quick add/i }).first();
    await expect(addButton).toBeVisible();
    await addButton.click();

    await page.getByRole('button', { name: /View order/i }).click();
    await page.getByRole('button', { name: /Send order/i }).click();

    await page.waitForFunction(() => (
      window.location.search.includes('order=')
      || document.body.innerText.includes('One or more items are unavailable')
    ), undefined, { timeout: 15_000 });

    if (page.url().includes('?order=')) {
      await expect(page.getByText(/Order received by the kitchen/i)).toBeVisible();
    }
  });
});
