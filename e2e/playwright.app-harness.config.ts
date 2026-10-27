import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Full-app visual harness (ui2/app-harness.html): the real ui2 app with a
// deterministic in-browser backend. Captures fixed screenshot specimens.
//
//   APP_HARNESS_OUT=/abs/out/dir npx playwright test -c playwright.app-harness.config.ts
//
// Browser ownership audits belong to the invoking session (see root AGENTS.md).
const DEFAULT_BROWSER =
  '/Users/bbuchsbaum/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';

// Dedicated port (strict); override only if 5327 is taken by another session.
const PORT = Number(process.env.APP_HARNESS_PORT ?? 5327);

export default defineConfig({
  testDir: './harness',
  testMatch: 'app-harness.capture.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: process.env.APP_HARNESS_RESULTS ?? 'test-results/app-harness',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.APP_HARNESS_BROWSER ?? DEFAULT_BROWSER,
      // Software WebGL (SwiftShader via ANGLE) for the three.js surface view:
      // deterministic across runs, independent of the host GPU.
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
