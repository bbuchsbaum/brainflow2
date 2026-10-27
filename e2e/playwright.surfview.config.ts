import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './harness', testMatch: 'surfview.spec.ts', workers: 1, retries: 0, timeout: 60_000,
  reporter: 'list', outputDir: process.env.SURFVIEW_QA_OUTPUT ?? 'test-results/surfview',
  use: {
    baseURL: 'http://127.0.0.1:5339', viewport: { width: 800, height: 700 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.SURFVIEW_QA_BROWSER,
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5339 --strictPort',
    cwd: resolve(__dirname, '../ui2'), url: 'http://127.0.0.1:5339/surfview-harness.html',
    reuseExistingServer: false, timeout: 60_000,
  },
});
