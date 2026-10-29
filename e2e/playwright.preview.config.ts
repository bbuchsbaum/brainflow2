import { defineConfig } from '@playwright/test';
if (!process.env.BROWSER_PREVIEW_URL || !process.env.BROWSER_PREVIEW_SHA || !process.env.BROWSER_PREVIEW_MANIFEST_SHA)
  throw new Error('BROWSER_PREVIEW_URL, BROWSER_PREVIEW_SHA and BROWSER_PREVIEW_MANIFEST_SHA are required');
export default defineConfig({
  testDir: './harness', testMatch: 'browser-preview.spec.ts', workers: 1, retries: 0,
  timeout: 180_000, reporter: 'list',
  outputDir: process.env.BROWSER_QA_OUTPUT ?? '../cruft/browser-completion/live-preview',
  use: { baseURL: process.env.BROWSER_PREVIEW_URL, viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.BROWSER_QA_BROWSER,
      args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] } },
});
