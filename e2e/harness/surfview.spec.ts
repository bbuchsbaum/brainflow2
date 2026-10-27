import { expect, test, type Page } from '@playwright/test';

type Pixels = { width: number; height: number; nonblack: number; r: number; g: number; b: number; bytes: number; center: number[] };
async function pixels(page: Page): Promise<Pixels> {
  await page.locator('#pixels').evaluate(el => { el.textContent = ''; });
  await page.getByRole('button', { name: 'export' }).click();
  await expect(page.locator('#pixels')).not.toBeEmpty();
  return JSON.parse((await page.locator('#pixels').textContent())!);
}
const distance = (a: Pixels, b: Pixels) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

test('surface pixels respond to layer controls and survive lifecycle', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/surfview-harness.html');
  await expect(page.getByRole('button', { name: 'export' })).toBeEnabled();
  await expect.poll(async () => (await pixels(page)).nonblack).toBeGreaterThan(1000);
  const initial = await pixels(page);
  expect(initial.bytes).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'base color' }).click();
  const recolored = await pixels(page);
  expect(distance(initial, recolored)).toBeLessThan(3);
  await page.getByRole('button', { name: 'scalar', exact: true }).click();
  const changed = await pixels(page);
  expect(distance(recolored, changed)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'threshold' }).click();
  const thresholded = await pixels(page);
  expect(distance(changed, thresholded)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'threshold' }).click();
  await page.getByRole('button', { name: 'opacity' }).click();
  expect(distance(changed, await pixels(page))).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'rgba' }).click();
  expect((await pixels(page)).nonblack).toBeGreaterThan(1000);
  await page.locator('#viewer canvas').click({ position: { x: 200, y: 200 } });
  await expect(page.locator('#pick')).not.toHaveText('none');
  await page.getByRole('button', { name: 'resize' }).click();
  expect((await pixels(page)).width).toBe(300);
  await page.getByRole('button', { name: 'unload' }).click();
  await page.getByRole('button', { name: 'mount' }).click();
  await expect(page.locator('#viewer canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'mount' }).click();
  await expect(page.getByRole('button', { name: 'export' })).toBeEnabled();
  expect((await pixels(page)).nonblack).toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath('surfview-remounted.png') });
  expect(await page.locator('#error').textContent()).toBe('');
  expect(errors).toEqual([]);
});


test('linked-cursor marker keeps its colour inside the dark halo', async ({ page }) => {
  await page.goto('/surfview-harness.html');
  await expect(page.getByRole('button', { name: 'export' })).toBeEnabled();
  await expect.poll(async () => (await pixels(page)).nonblack).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'marker' }).click();
  // A transparent halo sorts after the opaque marker and darkens it to ~(18, 48, 15).
  await expect.poll(async () => (await pixels(page)).center[1]).toBeGreaterThan(180);
  const [r, g, b] = (await pixels(page)).center;
  expect(g).toBeGreaterThan(r + 60);
  expect(g).toBeGreaterThan(b + 60);
});


test('real viewer retains owned world lights and requests linear volume filtering', async ({ page }) => {
  await page.goto('/surfview-harness.html');
  await page.getByRole('button', { name: 'inspect runtime' }).click();
  const runtime = JSON.parse((await page.locator('#runtime').textContent())!);
  expect(runtime.after).toBe(runtime.before);
  expect(runtime.position).toEqual([13, 27, 39]);
  expect(runtime.fill).toBe(0);
  expect(runtime.sampling).toBe('linear');
  expect(runtime.requestedFilter).toBe('linear');
  expect(runtime.effectiveFilter).toBe('linear');
});


for (const colormap of ['viridis', 'gray']) {
test('GPU linear volume projection matches the fractional scalar oracle: ' + colormap, async ({ page }, testInfo) => {
  const warnings: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.goto('/surfview-harness.html?ramp=' + colormap);
  await expect(page.getByRole('button', { name: 'export' })).toBeEnabled();
  await page.getByRole('button', { name: 'ramp scalar' }).click();
  await expect.poll(async () => (await pixels(page)).nonblack).toBeGreaterThan(1000);
  const scalar = await pixels(page);
  await page.getByRole('button', { name: 'ramp volume' }).click();
  const volume = await pixels(page);
  await page.screenshot({ path: testInfo.outputPath('surfview-volume.png') });
  await page.getByRole('button', { name: 'ramp zero' }).click();
  const zero = await pixels(page);
  expect(volume.nonblack).toBeGreaterThan(1000);
  const centerDistance = (a: Pixels, b: Pixels) => a.center.slice(0, 3).reduce((sum, x, i) => sum + Math.abs(x - b.center[i]), 0);
  expect(centerDistance(scalar, volume)).toBeLessThan(20);
  expect(centerDistance(scalar, zero)).toBeGreaterThan(30);
  expect(warnings.filter(warning => /colormap/i.test(warning))).toEqual([]);
});

}
