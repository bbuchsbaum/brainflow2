/**
 * Captures fixed screenshot specimens of the full ui2 app (app-harness.html).
 *
 *   APP_HARNESS_OUT=/abs/dir npx playwright test -c playwright.app-harness.config.ts
 *
 * For every scenario: wait for window.__harnessReady, fail on boot failure or
 * uncaught page errors, log unknown backend commands (they resolve to null),
 * and save <OUT>/<scenario>.png plus <OUT>/<scenario>.log.json.
 * `APP_HARNESS_SCENARIOS=volume,overlay` restricts the run.
 * `APP_HARNESS_DIRECTION=<id>` captures under a direction palette (see build-direction-tokens.mjs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SCENARIOS = [
  'empty',
  'volume',
  'volume-surface',
  'inspector-layer',
  'overlay',
  'plots',
  'mosaic',
  'analysis',
  'bids',
  'studio',
  'dialog-goto',
  'dialog-header',
  'dialog-crosshair',
];

/** Extra viewport variants: [scenario, width, height]. */
const VARIANTS: Array<[string, number, number]> = [
  ['volume', 1280, 800],
  ['inspector-layer', 1280, 800],
];

const OUT = process.env.APP_HARNESS_OUT;
const DIRECTION = process.env.APP_HARNESS_DIRECTION;
const ONLY = process.env.APP_HARNESS_SCENARIOS?.split(',').map((s) => s.trim()).filter(Boolean);

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

test.beforeAll(() => {
  if (!OUT) throw new Error('APP_HARNESS_OUT (absolute output directory) is required');
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((css: string) => {
    const install = () => {
      const style = document.createElement('style');
      style.setAttribute('data-app-harness', 'freeze');
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  }, FREEZE_CSS);
});

async function capture(page: Page, scenario: string, file: string): Promise<void> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(
    `/app-harness.html?scenario=${encodeURIComponent(scenario)}` +
      (DIRECTION ? `&direction=${encodeURIComponent(DIRECTION)}` : ''),
  );
  await page.waitForFunction(() => window.__harnessReady === true || !!window.__harnessFailed, null, {
    timeout: 90_000,
  });
  const failed = await page.evaluate(() => window.__harnessFailed ?? null);
  const log = await page.evaluate(() => {
    const l = window.__harnessLog;
    const counts: Record<string, number> = {};
    for (const c of l.calls) counts[c.cmd] = (counts[c.cmd] ?? 0) + 1;
    return { ...l, calls: counts };
  });
  writeFileSync(
    resolve(OUT!, `${file}.log.json`),
    JSON.stringify({ scenario, failed, log, consoleErrors, pageErrors }, null, 2),
  );
  if (log.unknown.length) console.log(`[${scenario}] unknown commands (answered null): ${log.unknown.join(', ')}`);
  if (log.fallbacks.length) console.log(`[${scenario}] fallbacks: ${log.fallbacks.join(' | ')}`);
  if (consoleErrors.length) console.log(`[${scenario}] console errors:\n  ${consoleErrors.join('\n  ')}`);

  expect(failed, `harness boot failed for ${scenario}`).toBeNull();
  expect(pageErrors, `uncaught page errors in ${scenario}`).toEqual([]);
  expect(log.pageErrors, `uncaught errors recorded by harness in ${scenario}`).toEqual([]);
  expect(log.errors, `backend handler errors in ${scenario}`).toEqual([]);

  await page.screenshot({ path: resolve(OUT!, `${file}.png`), animations: 'disabled', caret: 'hide' });
}

for (const scenario of SCENARIOS) {
  if (ONLY && !ONLY.includes(scenario)) continue;
  test(`capture ${scenario}`, async ({ page }) => {
    await capture(page, scenario, scenario);
  });
}

for (const [scenario, width, height] of VARIANTS) {
  if (ONLY && !ONLY.includes(scenario)) continue;
  test(`capture ${scenario} @${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await capture(page, scenario, `${scenario}@${width}x${height}`);
  });
}

declare global {
  interface Window {
    __harnessReady?: boolean;
    __harnessFailed?: string;
    __harnessLog: {
      calls: Array<{ cmd: string }>;
      unknown: string[];
      errors: Array<{ cmd: string; message: string }>;
      fallbacks: string[];
      pageErrors: string[];
    };
  }
}
