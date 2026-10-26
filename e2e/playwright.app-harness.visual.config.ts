import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Screenshot regression gate over the full-app harness and the primitives
// gallery (harness/app-harness.visual.spec.ts). Baselines live in
// harness/__screenshots__/<platform>/ and are tied to this headless shell,
// SwiftShader and the fonts bundled by ui2.
//
//   node_modules/.bin/playwright test -c playwright.app-harness.visual.config.ts
//   node_modules/.bin/playwright test -c playwright.app-harness.visual.config.ts --update-snapshots
//
// Browser ownership audits belong to the invoking session (see root AGENTS.md).
const DEFAULT_BROWSER =
  '/Users/bbuchsbaum/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';

// Dedicated port (strict), distinct from the capture config (5327/5328).
const PORT = Number(process.env.APP_HARNESS_PORT ?? 5329);

export default defineConfig({
  testDir: './harness',
  testMatch: 'app-harness.visual.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: process.env.APP_HARNESS_RESULTS ?? 'test-results/app-harness-visual',
  expect: {
    toHaveScreenshot: { maxDiffPixels: 24, threshold: 0.1, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    // No trace: a retained trace costs ~2 min per failing specimen here, and
    // the expected/actual/diff PNGs in outputDir already show the failure.
    trace: 'off',
    launchOptions: {
      executablePath: process.env.APP_HARNESS_BROWSER ?? DEFAULT_BROWSER,
      // Identical to playwright.app-harness.config.ts (deterministic software GL).
      args: [
        '--use-angle=swiftshader',
        '--use-gl=angle',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--font-render-hinting=none',
        '--disable-lcd-text',
      ],
    },
  },
  webServer: {
    command: `node_modules/.bin/vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: resolve(__dirname, '../ui2'),
    url: `http://127.0.0.1:${PORT}/app-harness.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
