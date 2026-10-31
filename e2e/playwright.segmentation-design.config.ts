import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Segmentation design hill climb (round captures): renders
// ui2/segmentation-harness.html for every direction x state and writes PNGs to
// cruft/hillclimb/segmentation/<round>/ (see harness/segmentation-design.capture.spec.ts).
//
//   SEG_DESIGN_BROWSER=/path/to/chrome-headless-shell \
//     node_modules/.bin/playwright test -c playwright.segmentation-design.config.ts
//
// Mock-only: no Tauri, no bridge. Browser ownership audits belong to the
// invoking session (see root AGENTS.md).
const PORT = Number(process.env.SEG_DESIGN_PORT ?? 5331);
const BROWSER = process.env.SEG_DESIGN_BROWSER ?? process.env.APP_HARNESS_BROWSER;

export default defineConfig({
  testDir: './harness',
  testMatch: 'segmentation-design.capture.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  outputDir: process.env.SEG_DESIGN_RESULTS ?? 'test-results/segmentation-design',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'off',
    launchOptions: {
      ...(BROWSER ? { executablePath: BROWSER } : {}),
      args: ['--font-render-hinting=none', '--disable-lcd-text'],
    },
  },
  webServer: {
    command: `node_modules/.bin/vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: resolve(__dirname, '../ui2'),
    url: `http://127.0.0.1:${PORT}/segmentation-harness.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
