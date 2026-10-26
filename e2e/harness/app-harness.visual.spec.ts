/**
 * Screenshot regression gate over the full-app harness (ui2/app-harness.html)
 * and the ui/bf primitives gallery (ui2/primitives-harness.html).
 *
 *   node_modules/.bin/playwright test -c playwright.app-harness.visual.config.ts
 *   node_modules/.bin/playwright test -c playwright.app-harness.visual.config.ts --update-snapshots
 *
 * Same scenarios, viewports and determinism (freeze CSS, SwiftShader, fixed
 * fonts/locale/timezone) as app-harness.capture.spec.ts. Each specimen must
 * boot without page or backend errors, then match its baseline in
 * harness/__screenshots__/ within `maxDiffPixels: 24, threshold: 0.1`.
 *
 * `APP_HARNESS_VISUAL_PROBE=1` injects a 1px outline on <body> through the
 * init script: a sensitivity check that must make every specimen fail.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  FREEZE_CSS,
  PRIMITIVE_PAGES,
  SCENARIOS,
  VARIANTS,
  installStyleScript,
} from './app-harness.scenarios';

const ONLY = process.env.APP_HARNESS_SCENARIOS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PROBE_CSS =
  'body { outline: 1px solid #ff00ff !important; outline-offset: -1px !important; }';

/**
 * Tolerance: a few antialiased glyph/edge pixels (1–8 px on two specimens)
 * vary between otherwise identical runs; a real chrome change moves far more.
 */
const SHOT = { maxDiffPixels: 24, threshold: 0.1, animations: 'disabled', caret: 'hide' } as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installStyleScript, [FREEZE_CSS, 'freeze'] as [string, string]);
  if (process.env.APP_HARNESS_VISUAL_PROBE === '1') {
    await page.addInitScript(installStyleScript, [PROBE_CSS, 'visual-probe'] as [string, string]);
  }
});

function trackErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return pageErrors;
}

async function openScenario(page: Page, scenario: string): Promise<void> {
  const pageErrors = trackErrors(page);
  await page.goto(`/app-harness.html?scenario=${encodeURIComponent(scenario)}`);
  await page.waitForFunction(
    () => window.__harnessReady === true || !!window.__harnessFailed,
    null,
    {
      timeout: 90_000,
    },
  );
  const failed = await page.evaluate(() => window.__harnessFailed ?? null);
  const log = await page.evaluate(() => ({
    errors: window.__harnessLog.errors,
    pageErrors: window.__harnessLog.pageErrors,
  }));
  expect(failed, `harness boot failed for ${scenario}`).toBeNull();
  expect(pageErrors, `uncaught page errors in ${scenario}`).toEqual([]);
  expect(log.pageErrors, `uncaught errors recorded by harness in ${scenario}`).toEqual([]);
  expect(log.errors, `backend handler errors in ${scenario}`).toEqual([]);
}

for (const scenario of SCENARIOS) {
  if (ONLY && !ONLY.includes(scenario)) continue;
  test(`visual ${scenario}`, async ({ page }) => {
    await openScenario(page, scenario);
    await expect(page).toHaveScreenshot(`${scenario}.png`, SHOT);
  });
}

for (const [scenario, width, height] of VARIANTS) {
  if (ONLY && !ONLY.includes(scenario)) continue;
  test(`visual ${scenario} @${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openScenario(page, scenario);
    await expect(page).toHaveScreenshot(`${scenario}@${width}x${height}.png`, SHOT);
  });
}

for (const [pageNo, file] of PRIMITIVE_PAGES) {
  if (ONLY && !ONLY.includes('primitives')) continue;
  test(`visual ${file}`, async ({ page }) => {
    const pageErrors = trackErrors(page);
    await page.goto(`/primitives-harness.html?page=${pageNo}`);
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60_000 });
    expect(pageErrors, `uncaught page errors in ${file}`).toEqual([]);
    await expect(page).toHaveScreenshot(`${file}.png`, { ...SHOT, fullPage: true });
  });
}
