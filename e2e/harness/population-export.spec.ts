import { test, expect } from '@playwright/test';

test('exports the selected participant estimand and common mask with a frozen calculation receipt', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export');
  await page.getByText('Save calculation', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export summary…', exact: true })).toBeEnabled();
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
  await expect(page.getByText(/Selected mean:/)).toContainText('1.000');
  const before = await page.locator('canvas').first().screenshot();
  const scale = await page.getByLabel('Population value scale limit', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Choose mask…', exact: true }).click();
  await expect(page.getByText(/Selected mean:/)).toContainText('0 finite');
  await expect(page.getByLabel('Population value scale limit', { exact: true })).toHaveValue(scale);
  const after = await page.locator('canvas').first().screenshot();
  expect(before.equals(after)).toBe(false);
  await page.getByRole('button', { name: 'Clear mask', exact: true }).click();
  await expect(page.getByText(/Selected mean:/)).toContainText('1.000');
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
  await expect(page.getByLabel('Population value scale limit', { exact: true })).toHaveValue('6');
  await expect(page.getByLabel('Plane', { exact: true })).toHaveValue('coronal');
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('1.5');
  await expect(page.getByRole('tab', { name: 'Deck', exact: true })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Compare', exact: true })).toBeDisabled();
  const inspector = page.getByRole('region', { name: 'Population inspector' });
  await expect(inspector).toContainText('40 selected / 80 available');
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
  await page.getByLabel('Plane', { exact: true }).selectOption('sagittal');
  await expect(inspector).toContainText('40 selected / 80 available');
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
    .getByText('NeuroTabs · Explore individuals and populations', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-workspace-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-workspace-narrow.png') });
  await inspector.getByText('Saved calculation · verified inputs', { exact: true }).click();
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
  await expect(page.getByRole('tab', { name: 'Deck', exact: true })).toBeEnabled();
});

test('scrubs and plays original observations, unfolds a montage and returns to the same person', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/population-harness.html?mask&export');
  await expect(page.getByText('Actual observation · S001', { exact: true })).toBeVisible();
  const inspector = page.getByRole('region', { name: 'Population inspector' });
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  await expect(page.getByText(/Selected mean:/)).toContainText('1.000');
  const limit = await page.getByLabel('Population value scale limit', { exact: true }).inputValue();
  const summary = await page.locator('canvas').first().screenshot();
  await page.getByRole('button', { name: 'Next observation', exact: true }).click();
  await expect(page.getByText('Actual observation · S002', { exact: true })).toBeVisible();
  expect(summary.equals(await page.locator('canvas').first().screenshot())).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).not.toHaveText('S002');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const focus = (await page.getByTestId('fixture-focus').textContent())!;
  await page.getByRole('button', { name: 'Montage', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Focus cutout ${focus}`, exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(inspector).toContainText('80 selected / 80 available');
  await page.getByRole('button', { name: 'Focus cutout S042', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S042');
  await expect(page.getByLabel('Population value scale limit', { exact: true })).toHaveValue(limit);
  await page.getByLabel('Population navigation').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('population-montage-desktop.png') });
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByText('Actual observation · S042', { exact: true })).toBeVisible();
  await expect(page.getByText(/Selected mean:/)).toContainText('1.000');
  await page
    .getByRole('button', { name: 'Order observations by pinned response', exact: true })
    .click();
  await expect(page.getByLabel('Population navigation')).toContainText('Response order at');
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
  await page.getByText('Select a range of observations', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply selection', exact: true }).click();
  await page.getByLabel('Selection name', { exact: true }).fill('One observer');
  await page.getByRole('button', { name: 'Save selection as set', exact: true }).click();
  await page.getByLabel('Group by factor', { exact: true }).selectOption('group');
  await page.getByRole('button', { name: 'Show factor groups', exact: true }).click();
  const a = page.getByRole('region', { name: 'group: A', exact: true }),
    b = page.getByRole('region', { name: 'group: B', exact: true });
  await expect(a.getByRole('button', { name: 'Use as A', exact: true })).toBeEnabled();
  await a.getByRole('button', { name: 'Use as A', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Use as B', exact: true })).toBeEnabled();
  await b.getByRole('button', { name: 'Use as B', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await page.screenshot({ path: testInfo.outputPath('population-factor-groups.png') });
  await page.getByRole('button', { name: 'Compare A and B', exact: true }).click();
  await expect(page.getByText(/^A mean ·/)).toBeVisible();
  await expect(page.getByText(/^B mean ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Show A − B', exact: true }).click();
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
  await page.getByRole('button', { name: 'Expand A and B', exact: true }).click();
  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Show contributors', exact: true })).toBeEnabled();
  await b.getByRole('button', { name: 'Show contributors', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Focus cutout S041', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Focus cutout S001', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Focus cutout S041', exact: true }).click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S041');
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '40 selected / 80 available',
  );

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
  await expect(page.getByText('Mean · 39 observations', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '40 selected / 80 available',
  );
  await page.keyboard.up('Space');
  await expect(page.getByRole('button', { name: 'Focus cutout S041', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo grouping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('fixture-focus')).toHaveText('S041');
  await expect(page.getByRole('button', { name: 'Refresh images', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('population-groups-narrow.png') });
  expect(errors).toEqual([]);
});

test('brushes original montage IDs on release while keeping focus independent', async ({
  page,
}) => {
  await page.goto('/population-harness.html?export');
  await page.getByRole('button', { name: 'Montage', exact: true }).click();
  const first = page.getByRole('button', { name: 'Focus cutout S001', exact: true });
  const second = page.getByRole('button', { name: 'Focus cutout S002', exact: true });
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Brush montage', exact: true }).click();
  const one = (await first.boundingBox())!,
    two = (await second.boundingBox())!;
  await page.mouse.move(one.x + 2, one.y + 2);
  await page.mouse.down();
  await page.mouse.move(two.x + two.width - 2, two.y + two.height - 2, { steps: 4 });
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '80 selected / 80 available',
  );
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Population inspector' })).toContainText(
    '2 selected / 80 available',
  );
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Brush montage', exact: true })).toBeVisible();
});
