import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Golden-path sales flow:
 *   login → create order → pay cash → verify inventory decrement → verify report row
 *
 * Requires: full backend stack running (postgres, kafka, all services), seeded data.
 * Skipped automatically when E2E_SALES_FLOW_ENABLED is unset to avoid CI noise.
 */
const ENABLED = process.env.E2E_SALES_FLOW_ENABLED === 'true';
const OUTLET_ID = process.env.E2E_OUTLET_ID || '10';
const ITEM_ID = process.env.E2E_ITEM_ID || '9001';

test.describe('Golden sales flow', () => {
  test.skip(!ENABLED, 'Set E2E_SALES_FLOW_ENABLED=true to run against live stack');

  test('admin login → create order → pay cash → verify inventory + report', async ({ page, request }) => {
    // 1. Login
    await login(page);

    // 2. Capture baseline stock
    const baselineRes = await request.get(
      `/api/v1/inventory/outlets/${OUTLET_ID}/items/${ITEM_ID}/stock-balance`
    );
    expect(baselineRes.ok()).toBeTruthy();
    const baseline = await baselineRes.json();
    const baselineQty = Number(baseline.qtyOnHand);

    // 3. Create + approve sale via UI (Sales page → New order → add item → approve → pay)
    await page.goto('/sales/orders/new');
    await page.getByRole('button', { name: /Add item/i }).click();
    await page.getByPlaceholder(/Search item/i).fill(String(ITEM_ID));
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: /Approve order/i }).click();
    await page.getByRole('button', { name: /Pay cash/i }).click();
    await expect(page.getByText(/Payment captured/i)).toBeVisible({ timeout: 10_000 });

    // 4. Verify inventory decrement (poll — async via Kafka)
    await expect.poll(async () => {
      const res = await request.get(
        `/api/v1/inventory/outlets/${OUTLET_ID}/items/${ITEM_ID}/stock-balance`
      );
      const data = await res.json();
      return Number(data.qtyOnHand);
    }, { timeout: 15_000 }).toBeLessThan(baselineQty);

    // 5. Verify sales report row
    const today = new Date().toISOString().slice(0, 10);
    const reportRes = await request.get(
      `/api/v1/reports/sales?outletId=${OUTLET_ID}&startDate=${today}&endDate=${today}`
    );
    expect(reportRes.ok()).toBeTruthy();
    const report = await reportRes.json();
    expect(report.items.length).toBeGreaterThan(0);
    expect(Number(report.items[0].saleCount)).toBeGreaterThan(0);
  });
});
