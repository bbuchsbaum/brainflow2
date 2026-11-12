import { test, expect, type Page } from '@playwright/test';

/** C′: an Inspector section (Compare and test, Analysis setup, Coverage and sources). */
async function openSection(page: Page, name: string) {
  const header = page.getByRole('button', { name: new RegExp(`^${name}`) }).first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
}
/** C′: a choice on toolbar row 2 (Show, Sort, Group, Tiles, Slice, Zoom). */
async function choose(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
}

/** The population toolbar's overflow (QA N13): open it to reach its controls. */
async function openMore(page: Page) {
  const more = page.locator('details:has(> summary[title="More"])').first();
  if (!(await more.evaluate((element) => (element as HTMLDetailsElement).open)))
    await more.locator('> summary').click();
}

/** Compose in Plot lives in the Values tab's ⋯ menu. */
async function composeInPlot(page: Page) {
  await page.getByRole('button', { name: 'More values actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compose in Plot', exact: true }).click();
}

test('exports the selected participant estimand and common mask with a frozen calculation receipt', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export');
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await openSection(page, 'Analysis setup');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('column:participant');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('mean');
  await page.getByRole('button', { name: 'Choose mask…', exact: true }).click();
  await expect(page.getByText('Mask: left-half-mask.nii', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved summary' })).toBeVisible();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.aggregation.within).toBe('mean');
  expect(receipt.population.aggregation.groups).toHaveLength(41);
  expect(receipt.population.aggregation.groups[0].memberIds).toHaveLength(40);
  expect(receipt.population.mask.expectedSha256).toBe('b'.repeat(64));
  expect(
    receipt.population.members.every(
      (m: { expectedSha256: string }) => m.expectedSha256 === 'a'.repeat(64),
    ),
  ).toBe(true);
  expect(receipt.context.metadata.S080.participant).toBe('P041');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await page.getByRole('button', { name: 'Export summary…', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-export-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-export-narrow.png') });
  expect(errors).toEqual([]);
});

test('mask changes preserve effect scales and clearing restores the population probe', async ({
  page,
}, testInfo) => {
  await page.goto('/population-harness.html?mask&export');
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  await expect(page.getByTestId('population-mean')).toContainText('1.000');
  const before = await page.locator('canvas').first().screenshot();
  const scale = await page.getByLabel('Upper limit', { exact: true }).inputValue();
  await openSection(page, 'Analysis setup');
  await page.getByRole('button', { name: 'Choose mask…', exact: true }).click();
  await expect(page.getByTestId('population-finite-count')).toHaveText('0');
  await expect(page.getByLabel('Upper limit', { exact: true })).toHaveValue(scale);
  const after = await page.locator('canvas').first().screenshot();
  expect(before.equals(after)).toBe(false);
  await page.getByRole('button', { name: 'Clear mask', exact: true }).click();
  await expect(page.getByTestId('population-mean')).toContainText('1.000');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await page.screenshot({ path: testInfo.outputPath('population-restored.png') });
});

test('recalculates a saved bundle without replacing live focus or weighting', async ({
  page,
}, testInfo) => {
  await page.goto('/population-harness.html?mask&export');
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Recalculate saved summary…', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Verified recalculation saved' }),
  ).toBeVisible();
  const receipt = JSON.parse((await page.getByTestId('synthetic-replay-receipt').textContent())!);
  expect(receipt.provenancePath).toBe('/synthetic/export/population-demo/provenance.json');
  expect(receipt.destinationDirectory).toBe('/synthetic/export');
  expect(Object.keys(receipt).sort()).toEqual(['destinationDirectory', 'provenancePath', 'ticket']);
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await expect(page.getByText(/^Analysis unit:/)).toContainText('observations');
  await page
    .getByRole('button', { name: 'Recalculate saved summary…', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-replay-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  await expect(
    page.getByRole('button', { name: 'Recalculate saved summary…', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-replay-narrow.png') });
});

test('opens a saved population into linked controls and an Inspector, then explores without changing membership', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/population-harness.html?mask&export');
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await expect(page.getByLabel('Upper limit', { exact: true })).toHaveValue('6');
  await expect(page.getByLabel('Slice', { exact: true })).toHaveValue('coronal');
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('1.5');
  // B5: the single-subject view is opened from a subject, not offered as a lens.
  await expect(page.getByRole('radio', { name: 'Subject', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Subject vs mean', exact: true })).toBeDisabled();
  const inspector = page.getByRole('region', { name: 'Population inspector' });
  await expect(inspector).toContainText('40 of 80 available');
  await openSection(page, 'Analysis setup');
  await inspector.getByText(/^Analysis unit:/).click();
  await expect(page.getByLabel('Participant identity', { exact: true })).toHaveValue('saved');
  await expect(page.getByLabel('Population analysis unit', { exact: true })).toHaveValue('mean');
  const inspectorBounds = await inspector.boundingBox();
  for (const select of await inspector.locator('select').all()) {
    const bounds = await select.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      inspectorBounds!.x + inspectorBounds!.width,
    );
  }
  await expect(page.getByText('Mask: left-half-mask.nii', { exact: true })).toBeVisible();
  await page.getByLabel('Slice', { exact: true }).selectOption('sagittal');
  await expect(inspector).toContainText('40 of 80 available');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await page.getByRole('button', { name: 'Clear mask', exact: true }).click();
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.members[0].stackIndex).toBe(1);
  expect(receipt.population.members[0].expectedSha256).toBe('a'.repeat(64));
  expect(receipt.population.workingMemberIds).toHaveLength(40);
  expect(receipt.population.aggregation.groups).toHaveLength(1);
  await page.getByText('Save calculation', { exact: true }).click();
  await page
    .locator('header[title="NeuroTabs · Explore individuals and populations"]')
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-workspace-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-workspace-narrow.png') });
  await openSection(page, 'Coverage and sources');
  await expect(inspector.getByText('Saved calculation · verified inputs', { exact: true })).toBeVisible();
  await expect(inspector).toContainText('Other observations remain inspectable');
  expect(errors).toEqual([]);
});

test('failed saved-source verification leaves the current population intact', async ({ page }) => {
  await page.goto('/population-harness.html?mask&export&open-error');
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Saved source hash changed' }),
  ).toBeVisible();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await expect(page.getByText(/^Analysis unit:/)).toContainText('observations');
  await expect(page.getByRole('radio', { name: 'Subject vs mean', exact: true })).toBeEnabled();
});

test('scrubs and plays original observations, unfolds a montage and returns to the same person', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/population-harness.html?mask&export');
  await expect(page.getByTestId('population-focused-subject')).toHaveText('S001');
  const inspector = page.getByRole('region', { name: 'Population inspector' });
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  await expect(page.getByTestId('population-mean')).toContainText('1.000');
  const limit = await page.getByLabel('Upper limit', { exact: true }).inputValue();
  const summary = await page.locator('canvas').first().screenshot();
  await page.getByRole('button', { name: 'Next subject in order', exact: true }).click();
  await expect(page.getByTestId('population-focused-subject')).toHaveText('S002');
  expect(summary.equals(await page.locator('canvas').first().screenshot())).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).not.toHaveText('S002');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const focus = (await page.getByTestId('fixture-focus').textContent())!;
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Focus subject ${focus}`, exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(inspector).toContainText('80 of 80 available');
  await page.getByRole('button', { name: 'Focus subject S042', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  // The fixture's mean is exactly 1 inside the brain, so the shared scale is ±1:
  // the Summary field and the montage footer must both read exactly "1".
  expect(limit).toBe('1');
  await expect(page.getByLabel('Upper limit', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Lower limit', { exact: true })).toHaveValue('-1');
  // C′: the transport is in the footer line under the montage.
  await page.getByLabel('Population navigation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-montage-desktop.png') });
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect(page.getByTestId('population-focused-subject')).toHaveText('S042');
  await expect(page.getByTestId('population-mean')).toContainText('1.000');
  // C′: the order by the pinned value is the montage's Sort.
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  await choose(page, 'Sort', 'crosshair');
  await expect(page.getByLabel('Population navigation')).toHaveAttribute(
    'title',
    /Response order at/,
  );
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.context.presentation.order.orderedIds[0]).toBe('S041');
  expect(receipt.context.presentation.order.bindings[0].expectedSha256).toBe('a'.repeat(64));
  expect(receipt.population.focusMemberId).toBe('S042');
  expect(receipt.population.workingMemberIds).toHaveLength(80);
  await page.setViewportSize({ width: 480, height: 1000 });
  await page.getByLabel('Population navigation').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-movie-narrow.png') });
  expect(errors).toEqual([]);
});

test('groups, compares, unfolds contributors and restores exact A/B operands', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export&roundtrip');
  // C′: no range form; Shift-click a tile, and the selection bar names and saves it.
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  await page.getByRole('button', { name: 'Focus subject S001', exact: true }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Save as group…', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('One observer');
  await page.getByLabel('Group name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  // C′: Group is on toolbar row 2; choosing a factor applies it.
  await choose(page, 'Group', 'factor:group');
  const a = page.getByRole('region', { name: 'group: A', exact: true }),
    b = page.getByRole('region', { name: 'group: B', exact: true });
  // A card's actions are in its ⋯.
  await a.getByRole('button', { name: 'Actions for group: A', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Use as A', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Use as A', exact: true }).click();
  await b.getByRole('button', { name: 'Actions for group: B', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Use as B', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Use as B', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await page.screenshot({ path: testInfo.outputPath('population-factor-groups.png') });
  // C′: Show offers A and B once B is set.
  await choose(page, 'Show', 'compare:ab');
  await expect(page.getByText(/^A mean ·/)).toBeVisible();
  await expect(page.getByText(/^B mean ·/)).toBeVisible();
  await choose(page, 'Show', 'compare:diff');
  await expect(page.getByText(/^A − B mean difference/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('population-difference.png') });
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.difference).toBe(true);
  expect(receipt.population.workingMemberIds).toHaveLength(40);
  expect(receipt.population.reference.memberIds).toHaveLength(40);
  expect(receipt.population.reference.memberIds[0]).toBe('S041');
  expect(receipt.context.exploration.partition.groups).toHaveLength(2);
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByText(/^A − B mean difference/)).toBeVisible();
  await choose(page, 'Show', 'compare:ab');
  // C′: the groups' means are the Summary with Group set (no Groups view).
  await choose(page, 'Show', 'mean');
  await b.getByRole('button', { name: 'Actions for group: B', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Show contributors', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Show contributors', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Focus subject S041', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Focus subject S001', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Focus subject S041', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S041');
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '40 of 80 available',
  );

  // C′: hold-to-preview and its unit are in the Inspector.
  const exclusion = page.getByLabel('Preview exclusion unit', { exact: true });
  const subset = await exclusion
    .locator('option')
    .filter({ hasText: 'Set: One observer' })
    .getAttribute('value');
  await exclusion.selectOption(subset!);
  const preview = page.getByRole('button', {
    name: 'Hold to preview without One observer (1 observation)',
    exact: true,
  });
  await preview.focus();
  await page.keyboard.down('Space');
  await expect(page.getByText('Group mean · 39 observations', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '40 of 80 available',
  );
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: 'Focus subject S041', exact: true })).toBeVisible();
  // C′: "Restore previous grouping" ends the Group menu.
  await choose(page, 'Group', 'restore');
  await expect(page.getByRole('radio', { name: 'Groups', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('fixture-focus')).toHaveText('S041');
  await openMore(page);
  await expect(page.getByRole('button', { name: 'Refresh images', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-groups-narrow.png') });
  expect(errors).toEqual([]);
});

test('a selection made on a data-derived order is exploratory, named, and exported as map-derived', async ({
  page,
}) => {
  await page.goto('/population-harness.html?export');
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  // Sort by similarity: the order on screen came from the maps.
  await choose(page, 'Sort', 'similarity:effect');
  await expect(page.getByRole('complementary', { name: 'Similarity map' })).toBeVisible();
  await page.getByRole('button', { name: 'Focus subject S001', exact: true }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Focus subject S002', exact: true }).click({ modifiers: ['Shift'] });
  const inspector = page.getByRole('region', { name: 'Population inspector' });
  await expect(inspector.getByText('Exploratory selection').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save as group…', exact: true }).click();
  await expect(page.getByLabel('Group name', { exact: true })).toHaveValue('2 subjects from the montage');
  await page.getByLabel('Group name', { exact: true }).fill('Data-picked pair');
  await page.getByLabel('Group name', { exact: true }).press('Enter');
  // Dropping one keeps it exploratory.
  await page.getByRole('button', { name: 'Focus subject S002', exact: true }).click({ modifiers: ['Shift'] });
  await expect(inspector.getByText('Exploratory selection').first()).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.context.selectionContext.working.origin).toBe('map-derived');
});

test('drags across montage tiles to select original IDs on release while keeping focus independent', async ({
  page,
}) => {
  await page.goto('/population-harness.html?export');
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  const first = page.getByRole('button', { name: 'Focus subject S001', exact: true });
  const second = page.getByRole('button', { name: 'Focus subject S002', exact: true });
  await expect(first).toBeVisible();
  // Selection needs no mode: there is no brush to switch on.
  await expect(page.getByRole('button', { name: 'Brush montage', exact: true })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
  const one = (await first.boundingBox())!,
    two = (await second.boundingBox())!;
  await page.mouse.move(one.x + 2, one.y + 2);
  await page.mouse.down();
  await page.mouse.move(two.x + two.width - 2, two.y + two.height - 2, { steps: 4 });
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '80 of 80 available',
  );
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '2 of 80 available',
  );
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('2 selected');
  // Escape, with no drag in progress, clears the selection and leaves focus alone.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '80 of 80 available',
  );
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
});

test('fits stable spatial relationships, orders the movie, groups and reopens the same fit', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export&roundtrip');
  // C′: Sort by similarity fits and orders at once; the map is the strip beside the grid.
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  await choose(page, 'Sort', 'similarity:effect');
  const strip = page.getByRole('complementary', { name: 'Similarity map' });
  const points = strip.getByRole('group', { name: 'Spatial MDS observations' });
  await expect(points).toBeVisible();
  await openSection(page, 'Coverage and sources');
  await expect(page.getByText(/90 \/ 100 common finite voxels/)).toBeVisible();
  const initial = await points
    .locator('circle')
    .evaluateAll((nodes) =>
      nodes.map((n) => [
        n.getAttribute('data-datum-id'),
        n.getAttribute('data-fit-x'),
        n.getAttribute('data-fit-y'),
      ]),
    );
  const focus = page.getByRole('button', { name: 'Focus relationship S042', exact: true });
  await focus.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await page.keyboard.press('Shift+Enter');
  expect(
    await points
      .locator('circle')
      .evaluateAll((nodes) =>
        nodes.map((n) => [
          n.getAttribute('data-datum-id'),
          n.getAttribute('data-fit-x'),
          n.getAttribute('data-fit-y'),
        ]),
      ),
  ).toEqual(initial);
  await expect(page.getByLabel('Population navigation')).toHaveAttribute(
    'title',
    /^MDS axis 1 · effect · fit dddddddd/,
  );
  await page.screenshot({ path: testInfo.outputPath('population-similarity-desktop.png') });
  // A point probe at radius 0 keeps its radius field one click away, in ⋯.
  await page.getByRole('button', { name: 'More values actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Set radius', exact: true }).click();
  await page.getByLabel('Probe radius in millimetres', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  // C′: where similarity is compared is set once, in Analysis setup.
  await openSection(page, 'Analysis setup');
  await page.getByLabel('Compare within', { exact: true }).selectOption('probe');
  await choose(page, 'Group', 'similarity:effect');
  await expect(page.getByText(/Fit eeeeeeee · 90/)).toBeVisible();
  await expect(page.getByLabel('Population navigation')).toHaveAttribute(
    'title',
    /fit dddddddd · earlier fit/,
  );
  await expect(page.getByRole('region', { name: 'Group 1', exact: true })).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export summary…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.context.relationship.geometry.coordinates).toHaveLength(80);
  expect(receipt.context.relationship.fitId).toBe('e'.repeat(64));
  expect(receipt.context.orderRelationship.fitId).toBe('d'.repeat(64));
  expect(receipt.context.presentation.order.orderedIds[0]).toBe('S041');
  expect(receipt.context.exploration.partition.origin).toBe('map-derived');
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByLabel('Population navigation')).toHaveAttribute(
    'title',
    /^MDS axis 1 · effect · fit dddddddd · earlier fit/,
  );
  await expect(points).toBeVisible();
  expect(
    await points
      .locator('circle')
      .evaluateAll((nodes) =>
        nodes.map((n) => [
          n.getAttribute('data-datum-id'),
          n.getAttribute('data-fit-x'),
          n.getAttribute('data-fit-y'),
        ]),
      ),
  ).toEqual(initial);
  await page.getByRole('button', { name: 'Lasso observations', exact: true }).click();
  await points.scrollIntoViewIfNeeded();
  const target = await focus.boundingBox();
  expect(target).not.toBeNull();
  const x = target!.x + target!.width / 2,
    y = target!.y + target!.height / 2;
  await page.mouse.move(x - 20, y - 20);
  await page.mouse.down();
  await page.mouse.move(x + 20, y - 20, { steps: 3 });
  await page.mouse.move(x + 20, y + 20, { steps: 3 });
  await page.mouse.move(x - 20, y + 20, { steps: 3 });
  await page.mouse.move(x - 20, y - 20, { steps: 3 });
  await page.mouse.up();
  await expect(points.locator('circle[aria-pressed="true"]')).toHaveCount(40);
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await page.getByRole('button', { name: 'Finish brushing', exact: true }).click();
  // C′: the measure is Sort's and Group's; a refusal is said in the strip.
  await choose(page, 'Sort', 'similarity:pattern-shape');
  await expect(strip.getByRole('alert').filter({ hasText: /constant/ })).toBeVisible();
  await expect(points.locator('circle')).toHaveCount(80);
  await strip.getByRole('button', { name: 'Use amplitude instead', exact: true }).click();
  await page.setViewportSize({ width: 480, height: 1000 });
  await points.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await strip.screenshot({ path: testInfo.outputPath('population-similarity-narrow.png') });
  expect(errors).toEqual([]);
});

test('declares participant effects, switches test channels and reopens a frozen discovery', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export&roundtrip');
  // C′: Compare and test (Inspector); choosing a test runs nothing, and says what is missing.
  await openSection(page, 'Compare and test');
  await openSection(page, 'Analysis setup');
  await page.getByLabel('Statistical method', { exact: true }).selectOption('oneSample');
  await expect(page.getByTestId('test-missing')).toContainText(/effect estimates/);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('% signal change');
  await page
    .getByLabel('I declare comparable effects from independent participants.', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /participant identities/ })).toBeVisible();
  await openSection(page, 'Analysis setup');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(
    page.getByText('Effect relative to null · 80 participants', { exact: true }),
  ).toBeVisible();
  // C′: a test's channels are offered by Show.
  const channel = page.getByLabel('Show', { exact: true });
  await channel.selectOption('t');
  await expect(page.getByText('t statistic · 80 participants', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next subject in order', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S002');
  await channel.selectOption('df');
  await expect(
    page.getByText('Degrees of freedom · 80 participants', { exact: true }),
  ).toBeVisible();
  await channel.selectOption('standardError');
  await expect(page.getByText('Standard error · 80 participants', { exact: true })).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Freeze discovery…', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Freeze discovery…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.inference).toMatchObject({
    method: 'oneSample',
    role: 'effect',
    units: '% signal change',
    nullValue: 0,
    independentParticipants: true,
    channel: 'standardError',
  });
  expect(receipt.population.aggregation.groups).toHaveLength(80);
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(channel).toHaveValue('standardError');
  await expect(page.getByText('Standard error · 80 participants', { exact: true })).toBeVisible();
  await page
    .getByLabel('Compare and test', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-inference-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Compare and test', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-inference-narrow.png') });
  // C′: the descriptive difference is a Test choice, applied by Run.
  await page.getByLabel('Statistical method', { exact: true }).selectOption('descriptive');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('Group mean · 80 participants', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('selects a method, compares independent groups, and reopens every Welch channel', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export&roundtrip');
  await openSection(page, 'Analysis setup');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await openSection(page, 'Compare and test');
  await openSection(page, 'Analysis setup');
  await page.getByLabel('Statistical method', { exact: true }).selectOption('welch');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('% signal change');
  await page
    .getByLabel('I declare comparable effects from independent participants.', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /population B/ })).toBeVisible();
  // C′: Group is on toolbar row 2; choosing a factor applies it.
  await choose(page, 'Group', 'factor:group');
  await page
    .getByRole('region', { name: 'group: A', exact: true })
    .getByRole('button', { name: 'Actions for group: A', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Use as A', exact: true }).click();
  await page
    .getByRole('region', { name: 'group: B', exact: true })
    .getByRole('button', { name: 'Actions for group: B', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Use as B', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(
    page.getByText('Effect relative to null · A 40 / B 40 participants', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('population-focused-subject')).toHaveText('S001');
  // C′: a test's channels are offered by Show.
  const channel = page.getByLabel('Show', { exact: true });
  await expect(channel.locator('option')).toHaveCount(6);
  for (const value of ['t', 'df', 'countA', 'countB']) {
    await channel.selectOption(value);
    await expect(channel).toHaveValue(value);
  }
  await page.getByRole('button', { name: 'Next subject in order', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S002');
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Freeze discovery…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.inference).toMatchObject({ method: 'welch', channel: 'countB' });
  expect(receipt.population.aggregation.groups).toHaveLength(40);
  expect(receipt.population.reference.aggregation.groups).toHaveLength(40);
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByLabel('Statistical method', { exact: true })).toHaveValue('welch');
  await expect(channel).toHaveValue('countB');
  await expect(
    page.getByText('Valid participants in B · A 40 / B 40 participants', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Compare and test', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-welch-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Compare and test', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-welch-narrow.png') });
  // C′: the descriptive difference is a Test choice, applied by Run.
  await page.getByLabel('Statistical method', { exact: true }).selectOption('descriptive');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('Group mean · 40 participants', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('matches paired participants, freezes pair counts and restores the question', async ({
  page,
}) => {
  await page.goto('/population-harness.html?mask&export&roundtrip&paired');
  await openSection(page, 'Analysis setup');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('column:participant');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await openSection(page, 'Compare and test');
  await openSection(page, 'Analysis setup');
  await page.getByLabel('Statistical method', { exact: true }).selectOption('paired');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('a.u.');
  await page.getByLabel('I declare comparable effects from independent participants.').check();
  // Select a factor group as A; its complement contains the matching second condition.
  // C′: Group is on toolbar row 2; choosing a factor applies it.
  await choose(page, 'Group', 'factor:group');

  // C′: A and B are chosen in Compare and test.
  await page.getByLabel('Assign group to A', { exact: true }).selectOption('factor-0');
  await page.getByLabel('Reference B', { exact: true }).selectOption('group:factor-1');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByLabel('Show', { exact: true }).selectOption('count');
  await expect(
    page.getByText('Valid pair count · A 40 / B 40 participants', { exact: true }),
  ).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Freeze discovery…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.inference.method).toBe('paired');
  expect(receipt.population.aggregation.groups).toHaveLength(40);
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByLabel('Show', { exact: true })).toHaveValue('count');
});

test('pins cached samples and composes grouped, faceted population plots', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export&plots');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 150, y: 150 } });
  await composeInPlot(page);
  const plot = page.getByLabel('Population plot authoring', { exact: true });
  await plot.getByLabel('Plot X', { exact: true }).selectOption('group');
  await plot.getByLabel('Plot Color', { exact: true }).selectOption('group');
  await plot.getByLabel('Plot Facet', { exact: true }).selectOption('site');
  await expect(plot.getByTestId('plot-facets')).toBeVisible();
  await expect(plot.locator('[data-datum-id]')).toHaveCount(80);
  await plot.locator('[data-datum-id="S042"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await plot.screenshot({ path: testInfo.outputPath('population-plot-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  await page.reload();
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 150, y: 150 } });
  await composeInPlot(page);
  await plot.screenshot({ path: testInfo.outputPath('population-plot-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('declares an OLS covariate and exports the participant-keyed design', async ({
  page,
}, testInfo) => {
  await page.goto('/population-harness.html?mask&export&ols');
  await openSection(page, 'Analysis setup');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await openSection(page, 'Compare and test');
  await openSection(page, 'Analysis setup');
  await page.getByLabel('Statistical method', { exact: true }).selectOption('linearModel');
  await page.getByRole('checkbox', { name: 'age', exact: true }).check();
  await page.getByLabel('Model coefficient', { exact: true }).selectOption('age');
  await page.getByLabel('Coefficient units', { exact: true }).fill('a.u. / year');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('a.u.');
  await page
    .getByRole('checkbox', { name: 'I declare comparable effects from independent participants.' })
    .check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'coefficient contrast' })).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Freeze discovery…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.inference.design.columns).toEqual(['(intercept)', 'age']);
  expect(receipt.population.inference.design.contrast).toEqual([0, 1]);
  expect(receipt.population.inference.design.values[0]).toEqual([1, 20]);
  expect(receipt.population.reference).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('population-ols.png') });
});

test('combines identical pinned probes once and keeps original image links', async ({
  page,
}, testInfo) => {
  await page.goto('/population-harness.html?mask&export&plots&combine');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 150, y: 150 } });
  await composeInPlot(page);
  await composeInPlot(page);
  const plot = page.getByLabel('Population plot authoring', { exact: true });
  await plot.getByText('Combine pinned plots', { exact: true }).click();
  const choices = plot.getByRole('checkbox');
  await choices.nth(0).check();
  await choices.nth(1).check();
  await plot.getByRole('button', { name: 'Combine samples', exact: true }).click();
  await expect(plot.getByText(/Pinned samples · 80 \/ 80 sample rows/)).toBeVisible();
  await expect(plot.locator('[data-datum-id]')).toHaveCount(80);
  await plot.locator('[data-datum-id]').nth(41).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await plot.screenshot({ path: testInfo.outputPath('population-combined.png') });
});

test('samples declared 4D frames and focuses a real time point without replacing the cohort', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export&plots&combine');
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 150, y: 150 } });
  await composeInPlot(page);
  const plot = page.getByLabel('Population plot authoring', { exact: true });
  await plot.getByText('Create time courses from 4D images', { exact: true }).click();
  await plot.getByLabel('Frame count', { exact: true }).fill('3');
  await plot.getByLabel('Time step', { exact: true }).fill('2');
  await plot
    .getByRole('checkbox', { name: 'These sources share this time axis and frame alignment.' })
    .check();
  await plot.getByRole('button', { name: 'Create time courses', exact: true }).click();
  await expect(plot.locator('[data-datum-id]')).toHaveCount(240);
  const point = plot.getByRole('button', { name: '["S042",2]: 2', exact: true });
  await point.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await expect(page.getByTestId('population-focused-subject')).toHaveText('S042');
  await expect(page.getByText('frame 3', { exact: true })).toBeVisible();
  await expect(page.getByTestId('population-mean')).toContainText('1.000');
  await plot.getByLabel('Plot membership binding', { exact: true }).selectOption('working');
  await page.getByRole('button', { name: 'Focused only', exact: true }).click();
  await expect(plot.locator('[data-datum-id]')).toHaveCount(3);
  await expect(plot.getByText(/Pinned samples · 3 \/ 240 sample rows/)).toBeVisible();
  await plot.evaluate((el) => (el.scrollTop = 0));
  await plot.screenshot({ path: testInfo.outputPath('population-time-courses.png') });
  const downloading = page.waitForEvent('download');
  await plot.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloading;
  await download.saveAs(testInfo.outputPath('population-time-courses.png-export.png'));
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(errors).toEqual([]);
});

test('selects exact crossed-factor cells without moving focus', async ({ page }, testInfo) => {
  await page.goto('/population-harness.html?export');
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  // C′: "Two factors…" in the Group menu; the matrix is in the Values tab's Table.
  await choose(page, 'Group', 'two:["group","site"]');
  await page.getByRole('radio', { name: 'Table', exact: true }).click();
  const matrix = page.getByLabel('Population group matrix', { exact: true });
  await matrix.locator('summary').click();
  const cells = matrix.locator('tbody button');
  await expect(cells.first()).toBeEnabled();
  await cells.first().click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await expect(page.getByTestId('population-mean')).toContainText('3.000');
  await matrix.screenshot({ path: testInfo.outputPath('population-group-matrix.png') });
});

test('renders a labeled reconstruction in the shared anatomical viewport', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export');
  // C′: Sort by similarity fits; the explanation is under Nearest subjects in the Inspector.
  await page.getByRole('tab', { name: 'Montage', exact: true }).click();
  await choose(page, 'Sort', 'similarity:effect');
  await page.getByText('Explain in the brain', { exact: true }).click();
  const explanation = page.getByLabel('Explain spatial relationships', { exact: true });
  await explanation
    .getByLabel('Relationship explanation', { exact: true })
    .selectOption('reconstruction');
  await explanation.getByRole('button', { name: 'Show current slice', exact: true }).click();
  await expect(explanation.getByText(/Reconstruction of S001/)).toBeVisible();
  await expect(explanation.locator('canvas')).toBeVisible();
  await explanation.screenshot({ path: testInfo.outputPath('population-reconstruction.png') });
  expect(errors).toEqual([]);
});
