/**
 * Captures the segmentation design directions (ui2/segmentation-harness.html):
 * every direction x state at 1440x900, plus the multi-contrast state at
 * 1280x800, into cruft/hillclimb/segmentation/<round>/<direction>/<state>.png
 * with a manifest.json. Fails on boot failures and uncaught page errors.
 *
 *   SEG_DESIGN_ROUND=round-0 SEG_DESIGN_DIRECTIONS=a,b SEG_DESIGN_STATES=tracing \
 *     node_modules/.bin/playwright test -c playwright.segmentation-design.config.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FREEZE_CSS, installStyleScript } from './app-harness.scenarios';

const ROUND = process.env.SEG_DESIGN_ROUND ?? 'round-0';
const OUT = process.env.SEG_DESIGN_OUT ?? resolve(__dirname, '../../cruft/hillclimb/segmentation', ROUND);
const pick = (v: string | undefined, all: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter((s) => all.includes(s)) : all;

const DIRECTIONS: Record<string, string> = { a: 'Workstation', b: 'Reading room', c: 'Protocol-guided' };
const STATES: Array<[string, string]> = [
  ['empty', 'Empty session: T2w and T1w loaded, no segmentation yet'],
  ['tracing', 'Tracing: brush mid-stroke on coronal T2w, constraint strip, label list'],
  ['multi-contrast', 'Multi-contrast Trace layout: primary, two orthogonal panels, linked contrast strip'],
  ['blocked', 'Blocked stroke: painting CA1 over the locked DG; the UI explains why nothing happened'],
  ['proposal', 'Fill-between-slices proposal: dashed/hatched CA1, Confirm CA1, keyframes, proposal undo'],
  ['review', 'Review mode: rater A solid, rater B dashed, disagreement, navigation, approve/return'],
  ['zoom', 'Zoomed tracing: 6x with voxel grid and the exact brush footprint'],
];
const VARIANTS: Array<[string, number, number]> = [['multi-contrast', 1280, 800]];

const directions = pick(process.env.SEG_DESIGN_DIRECTIONS, Object.keys(DIRECTIONS));
const states = pick(process.env.SEG_DESIGN_STATES, STATES.map(([s]) => s));

interface Shot {
  direction: string;
  state: string;
  file: string;
  viewport: [number, number];
}
const shots: Shot[] = [];

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(installStyleScript, [FREEZE_CSS, 'freeze'] as [string, string]);
});

async function capture(page: Page, direction: string, state: string, file: string): Promise<void> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  });
  await page.goto(`/segmentation-harness.html?direction=${direction}&state=${state}`);
  await page.waitForFunction(() => window.__harnessReady === true || !!window.__harnessFailed, null, {
    timeout: 60_000,
  });
  const failed = await page.evaluate(() => window.__harnessFailed ?? null);
  expect(failed, `harness failed for ${direction}/${state}`).toBeNull();
  expect(pageErrors, `uncaught page errors in ${direction}/${state}`).toEqual([]);
  expect(consoleErrors, `console errors in ${direction}/${state}`).toEqual([]);
  mkdirSync(resolve(OUT, direction), { recursive: true });
  await page.screenshot({ path: resolve(OUT, direction, file), animations: 'disabled', caret: 'hide' });
}

for (const direction of directions) {
  for (const state of states) {
    test(`capture ${direction}/${state}`, async ({ page }) => {
      await capture(page, direction, state, `${state}.png`);
      shots.push({ direction, state, file: `${direction}/${state}.png`, viewport: [1440, 900] });
    });
  }
  for (const [state, width, height] of VARIANTS) {
    if (!states.includes(state)) continue;
    test(`capture ${direction}/${state} @${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const file = `${state}@${width}x${height}.png`;
      await capture(page, direction, state, file);
      shots.push({ direction, state, file: `${direction}/${file}`, viewport: [width, height] });
    });
  }
}

test.afterAll(() => {
  const manifest = {
    round: ROUND,
    harness: 'ui2/segmentation-harness.html?direction=<id>&state=<state>',
    honesty:
      'Images are real MNI152NLin2009cAsym 1 mm T2w/T1w template slices (TemplateFlow); the third strip panel is a view-only unsharp mask of T2w. Subfield labels, strokes, proposals, rater B and all counts are mock data; editing is simulated (no bridge).',
    directions: directions.map((id) => ({ id, title: DIRECTIONS[id] })),
    states: STATES.filter(([s]) => states.includes(s)).map(([id, description], i) => ({ id, index: i + 1, description })),
    shots: shots.sort((a, b) => a.file.localeCompare(b.file)),
  };
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
});
