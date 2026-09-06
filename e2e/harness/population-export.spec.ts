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
