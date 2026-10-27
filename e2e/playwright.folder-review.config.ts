import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './harness',
  testMatch: 'folder-review.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.POPULATION_QA_OUTPUT ?? 'test-results/folder-review',
  use: {
    baseURL: 'http://127.0.0.1:5323',
    viewport: { width: 1000, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: process.env.POPULATION_QA_BROWSER
      ? {
          executablePath: process.env.POPULATION_QA_BROWSER,
          ignoreDefaultArgs: ['--headless=old'],
          args: ['--headless=new'],
        }
      : {},
  },
  webServer: {
    command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5323 --strictPort',
    cwd: resolve(__dirname, '../ui2'),
    url: 'http://127.0.0.1:5323/folder-review-harness.html',
    reuseExistingServer: false,
  },
});
