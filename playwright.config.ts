import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5860',
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  webServer: {
    command: 'node dist/server/index.js',
    url: 'http://127.0.0.1:5860/healthz',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: {
      PORT: '5860',
      HOST: '127.0.0.1',
      DATA_DIR: './.data/e2e-rooms',
      ALLOWED_ORIGINS: 'http://127.0.0.1:5860',
    },
  },
})
