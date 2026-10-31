/**
 * Captures the segmentation design directions (ui2/segmentation-harness.html):
 * every direction x state at 1440x900, plus the multi-contrast, tracing and
 * lesion states at 1280x800, and (direction h) the round-5 workflow states
 * listed in segmentation-design.workflow.json, into cruft/hillclimb/segmentation/<round>/<direction>/<state>.png
 * with a manifest.json. Fails on boot failures and uncaught page errors.
 *
 *   SEG_DESIGN_ROUND=round-0 SEG_DESIGN_DIRECTIONS=a,b SEG_DESIGN_STATES=tracing \
 *     node_modules/.bin/playwright test -c playwright.segmentation-design.config.ts
 *
 * Design parity (SEG_DESIGN_PARITY=1): renders direction h's states and
 * compares each against docs/design/segmentation/reference/<state>.png
 * (SEG_DESIGN_PARITY_REF overrides the folder). A pixel differs when any
 * channel differs by more than SEG_DESIGN_PARITY_THRESHOLD (default 24 of
 * 255); a state fails when more than SEG_DESIGN_PARITY_MAX of its pixels
 * differ (default 0.005, i.e. 0.5%). Writes the renders, a diff image per
 * state and parity.json to SEG_DESIGN_OUT (default
 * test-results/segmentation-parity). Advisory, not a CI gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { FREEZE_CSS, installStyleScript } from './app-harness.scenarios';

const PARITY = process.env.SEG_DESIGN_PARITY === '1';
const PARITY_REF = process.env.SEG_DESIGN_PARITY_REF ?? resolve(__dirname, '../../docs/design/segmentation/reference');
const PARITY_THRESHOLD = Number(process.env.SEG_DESIGN_PARITY_THRESHOLD ?? 24);
const PARITY_MAX = Number(process.env.SEG_DESIGN_PARITY_MAX ?? 0.005);
const ROUND = process.env.SEG_DESIGN_ROUND ?? 'round-0';
const OUT =
  process.env.SEG_DESIGN_OUT ??
  (PARITY ? resolve(__dirname, '../test-results/segmentation-parity') : resolve(__dirname, '../../cruft/hillclimb/segmentation', ROUND));
const pick = (v: string | undefined, all: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter((s) => all.includes(s)) : all;

const DIRECTIONS: Record<string, string> = { a: 'Workstation', b: 'Reading room', c: 'Protocol-guided', h: 'Hybrid' };
const STATES: Array<[string, string]> = [
  ['empty', 'Empty session: T2w and T1w loaded, no segmentation yet'],
  ['tracing', 'Tracing: brush mid-stroke on the oblique coronal T2w, constraint strip, label list'],
  ['multi-contrast', 'Multi-contrast Trace layout: primary, two orthogonal panels, linked contrast strip'],
  ['blocked', 'Blocked stroke: painting CA1 over the locked DG; the UI explains why nothing happened'],
  ['proposal', 'Fill-between-slices proposal: hatched CA1 with a thin solid outline, accept per slice, keyframes, proposal undo'],
  ['review', 'Review mode: rater A solid, rater B dashed where it departs, disagreement textures, flagged navigation, approve/return'],
  ['zoom', 'Zoomed tracing: 6x with voxel grid and the exact brush footprint'],
];
/**
 * Round 5: workflow states, direction h only. Each carries its description,
 * its design decisions and what is mocked, for the manifest.
 */
interface WorkflowShot {
  id: string;
  description: string;
  decisions: string[];
  mocked: string;
}
const WORKFLOW: WorkflowShot[] = JSON.parse(
  readFileSync(resolve(__dirname, 'segmentation-design.workflow.json'), 'utf8'),
) as WorkflowShot[];
const VARIANTS: Array<[string, number, number]> = [
  ['multi-contrast', 1280, 800],
  ['tracing', 1280, 800],
  ['lesion', 1280, 800],
];

// Parity compares the final direction only: the reference holds direction h.
const directions = PARITY ? ['h'] : pick(process.env.SEG_DESIGN_DIRECTIONS, Object.keys(DIRECTIONS));
const allStates = [...STATES.map(([s]) => s), ...WORKFLOW.map((w) => w.id)];
const states = pick(process.env.SEG_DESIGN_STATES, allStates);
const supports = (direction: string, state: string) => direction === 'h' || STATES.some(([s]) => s === state);

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
  if (PARITY) compareWithReference(resolve(OUT, direction, file), file);
}

interface ParityResult {
  file: string;
  size: [number, number];
  differing: number;
  fraction: number;
  maxChannelDelta: number;
  pass: boolean;
}
const parity: ParityResult[] = [];

/**
 * Compares a render with the reference PNG of the same name: per pixel, the
 * largest channel difference; pixels above the threshold count as differing
 * and are painted into a diff image (red over a dimmed reference).
 */
function compareWithReference(renderPath: string, file: string): void {
  const refPath = resolve(PARITY_REF, file);
  expect(existsSync(refPath), `no reference for ${file} in ${PARITY_REF}`).toBe(true);
  const a = PNG.sync.read(readFileSync(refPath));
  const b = PNG.sync.read(readFileSync(renderPath));
  expect([b.width, b.height], `${file}: size differs from the reference`).toEqual([a.width, a.height]);
  const diff = new PNG({ width: a.width, height: a.height });
  let differing = 0;
  let maxChannelDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    maxChannelDelta = Math.max(maxChannelDelta, d);
    const grey = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3 / 3);
    if (d > PARITY_THRESHOLD) {
      differing++;
      diff.data.set([255, 0, 0, 255], i);
    } else {
      diff.data.set([grey, grey, grey, 255], i);
    }
  }
  const fraction = differing / (a.width * a.height);
  const pass = fraction <= PARITY_MAX;
  mkdirSync(resolve(OUT, 'diff'), { recursive: true });
  writeFileSync(resolve(OUT, 'diff', file), PNG.sync.write(diff));
  parity.push({ file, size: [a.width, a.height], differing, fraction, maxChannelDelta, pass });
  expect(
    fraction,
    `${file}: ${(fraction * 100).toFixed(3)}% of pixels differ from the reference by more than ${PARITY_THRESHOLD} (allowed ${(PARITY_MAX * 100).toFixed(3)}%); see ${resolve(OUT, 'diff', file)}`,
  ).toBeLessThanOrEqual(PARITY_MAX);
}

for (const direction of directions) {
  for (const state of states) {
    if (!supports(direction, state)) continue;
    test(`capture ${direction}/${state}`, async ({ page }) => {
      await capture(page, direction, state, `${state}.png`);
      shots.push({ direction, state, file: `${direction}/${state}.png`, viewport: [1440, 900] });
    });
  }
  for (const [state, width, height] of VARIANTS) {
    if (!states.includes(state) || !supports(direction, state)) continue;
    test(`capture ${direction}/${state} @${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const file = `${state}@${width}x${height}.png`;
      await capture(page, direction, state, file);
      shots.push({ direction, state, file: `${direction}/${file}`, viewport: [width, height] });
    });
  }
}

test.afterAll(() => {
  if (PARITY) {
    const report = {
      reference: PARITY_REF,
      threshold: PARITY_THRESHOLD,
      maxFraction: PARITY_MAX,
      results: parity.sort((x, y) => x.file.localeCompare(y.file)),
      pass: parity.every((r) => r.pass),
    };
    writeFileSync(resolve(OUT, 'parity.json'), JSON.stringify(report, null, 2));
    return;
  }
  const manifest = {
    round: ROUND,
    harness: 'ui2/segmentation-harness.html?direction=<id>&state=<state>',
    honesty:
      'Images are real MNI152NLin2009cAsym 1 mm T2w/T1w template slices (TemplateFlow); the third strip panel is a view-only unsharp mask of T2w. Subfield labels, strokes, proposals, rater B and all counts are mock data; editing is simulated (no bridge). Direction h states a native 0.40x0.40/2.0 mm T2 geometry that is SIMULATED: the imagery stays 1 mm, native slices are every second template slice. Round 5 (direction h workflow states): the FLAIR in state lesion is a MOCK derived from the MNI152 T1w template and its lesions are synthetic; AI answers, servers, journals, files and times are mock. Round 6: every session fact (journal, provenance, ruler and matrix marks) comes from one mock session model; the lesion T1w/T2w are the real templates. Round 7: the AI state is the same session model at step 31; the setup checkerboard pairs the T1w and T2w templates (a perfect registration).',
    directions: directions.map((id) => ({ id, title: DIRECTIONS[id] })),
    states: [
      ...STATES.filter(([s]) => states.includes(s)).map(([id, description]) => ({ id, description })),
      ...WORKFLOW.filter((w) => states.includes(w.id)).map((w) => ({ id: w.id, description: w.description, decisions: w.decisions, mocked: w.mocked, round: Number(ROUND.replace(/\D/g, '')) || 5 })),
    ].map((s, i) => ({ index: i + 1, ...s })),
    shots: shots.sort((a, b) => a.file.localeCompare(b.file)),
  };
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
});
