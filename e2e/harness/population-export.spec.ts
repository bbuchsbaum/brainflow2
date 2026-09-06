import { test, expect } from '@playwright/test';

test('exports the selected participant estimand and common mask with a frozen calculation receipt', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export');
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
