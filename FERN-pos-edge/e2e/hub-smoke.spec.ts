import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MockHubServer } from './mock-hub'

const hubPort = Number(process.env.E2E_HUB_PORT ?? 18099)
const hub = new MockHubServer()

test.beforeAll(async () => {
  await hub.start(hubPort)
})

test.afterAll(async () => {
  await hub.stop()
})

test.beforeEach(() => {
  hub.reset()
})

async function newTerminal(browser: Browser, registerCode: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await context.addInitScript(({ code }) => {
    localStorage.setItem('fern-terminal-profile', JSON.stringify({
      registerCode: code,
      displayName: code.replace('-', ' '),
    }))
  }, { code: registerCode })
  return { context, page: await context.newPage() }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="text"]').fill('cashier')
  await page.locator('input[type="password"]').fill('cashier-pass')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

async function openShift(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Bắt đầu ca' })).toBeVisible()
  await page.getByRole('button', { name: 'Bắt đầu ca' }).click()
  await expect(page.getByText('Mini server OK')).toBeVisible()
  await expect(page.getByRole('button', { name: /Cold Brew/ })).toBeVisible()
}

test('two terminals in one outlet keep separate register sessions and same-register takeover is explicit', async ({ browser }) => {
  const terminalA = await newTerminal(browser, 'REGISTER-A')
  const terminalB = await newTerminal(browser, 'REGISTER-B')
  const duplicateA = await newTerminal(browser, 'REGISTER-A')

  await login(terminalA.page)
  await openShift(terminalA.page)

  await login(terminalB.page)
  await openShift(terminalB.page)

  await login(duplicateA.page)
  await expect(duplicateA.page.getByRole('button', { name: 'Bắt đầu ca' })).toBeVisible()

  let sawTakeoverDialog = false
  duplicateA.page.once('dialog', async dialog => {
    sawTakeoverDialog = true
    expect(dialog.message()).toContain('Register này đang có ca mở')
    await dialog.dismiss()
  })
  await duplicateA.page.getByRole('button', { name: 'Bắt đầu ca' }).click()
  await expect(duplicateA.page.getByRole('button', { name: 'Bắt đầu ca' })).toBeVisible()
  expect(sawTakeoverDialog).toBe(true)
  expect(hub.openSessionCount).toBe(2)

  await terminalA.context.close()
  await terminalB.context.close()
  await duplicateA.context.close()
})

test('terminal consumes hub SSE for menu invalidation and blocks sales during LAN drop until reconnect', async ({ browser }) => {
  const terminal = await newTerminal(browser, 'REGISTER-C')
  await login(terminal.page)
  await openShift(terminal.page)

  hub.renameProduct('SSE Latte')
  await expect(terminal.page.getByRole('button', { name: /SSE Latte/ })).toBeVisible()

  await terminal.page.getByRole('button', { name: /SSE Latte/ }).click()
  await terminal.page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  await expect(terminal.page.getByText('Giỏ hàng (1 món)')).toBeVisible()

  hub.setLanReachable(false)
  await expect(terminal.page.getByText('Mini server unreachable')).toBeVisible()
  await expect(terminal.page.getByRole('button', { name: 'Thanh toán' })).toBeDisabled()

  hub.setLanReachable(true)
  await expect(terminal.page.getByText('Mini server OK')).toBeVisible()
  await expect(terminal.page.getByRole('button', { name: 'Thanh toán' })).toBeEnabled()

  await terminal.context.close()
})
