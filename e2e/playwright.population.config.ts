import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Isolated development harness: real controls/canvases, explicitly synthetic IPC.
// Browser ownership audits belong to the invoking session (see root AGENTS.md).
export default defineConfig({
  testDir: './harness',
  testMatch: 'population-export.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: process.env.POPULATION_QA_OUTPUT ?? 'test-results/population',
  use: {
    baseURL: 'http://127.0.0.1:5321',
    viewport: { width: 1100, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.POPULATION_QA_BROWSER
      ? { executablePath: process.env.POPULATION_QA_BROWSER }
      : {},
  },
  webServer: {
    command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5321 --strictPort',
    cwd: resolve(__dirname, '../ui2'),
    url: 'http://127.0.0.1:5321/population-harness.html',
    reuseExistingServer: false,
  },
});
