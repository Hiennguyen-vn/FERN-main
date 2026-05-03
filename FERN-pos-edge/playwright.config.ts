import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 5175)
const hubPort = Number(process.env.E2E_HUB_PORT ?? 18099)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `VITE_AGENT_URL=http://127.0.0.1:${hubPort} npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
