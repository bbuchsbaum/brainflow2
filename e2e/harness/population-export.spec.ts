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

test('fits stable spatial relationships, orders the movie, groups and reopens the same fit', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export&roundtrip');
  await page.getByText('Spatial relationships', { exact: true }).click();
  await page.getByRole('button', { name: 'Fit on current support', exact: true }).click();
  const points = page.getByRole('group', { name: 'Spatial MDS observations' });
  await expect(points).toBeVisible();
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
  await page.getByRole('button', { name: 'Order movie by MDS axis 1', exact: true }).click();
  await expect(
    page.getByText(/^MDS axis 1 · effect · fit dddddddd · Show every observation/),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('population-similarity-desktop.png') });
  await page.getByLabel('Probe radius in millimetres', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Pin crosshair', exact: true }).click();
  await page.getByRole('button', { name: 'Compare maps in pinned region', exact: true }).click();
  await expect(page.getByText(/Fit eeeeeeee · 90/)).toBeVisible();
  await expect(page.getByText(/fit dddddddd · earlier fit · Show every observation/)).toBeVisible();
  await page.getByRole('button', { name: 'Create similarity groups', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Similarity group 1', exact: true })).toBeVisible();
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
  await expect(
    page.getByText(/^MDS axis 1 · effect · fit dddddddd · earlier fit · Show every observation/),
  ).toBeVisible();
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
  await page.getByLabel('Spatial distance', { exact: true }).selectOption('pattern-shape');
  await page.getByRole('button', { name: 'Fit on current support', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /constant/ })).toBeVisible();
  await expect(points.locator('circle')).toHaveCount(80);
  await page.getByLabel('Spatial distance', { exact: true }).selectOption('effect');
  await page.setViewportSize({ width: 480, height: 1000 });
  await points.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Spatial relationships', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-similarity-narrow.png') });
  expect(errors).toEqual([]);
});

test('declares participant effects, switches test channels and reopens a frozen discovery', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export&roundtrip');
  await page.getByText('Statistical question', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply one-sample test', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /effect estimates/ })).toBeVisible();
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('% signal change');
  await page
    .getByLabel('I declare comparable effects from independent participants.', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Apply one-sample test', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /participant identities/ })).toBeVisible();
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Apply one-sample test', exact: true }).click();
  await expect(
    page.getByText('Effect relative to null · 80 participants', { exact: true }),
  ).toBeVisible();
  const channel = page.getByLabel('Test result channel', { exact: true });
  await channel.selectOption('t');
  await expect(page.getByText('t statistic · 80 participants', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next observation', exact: true }).click();
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
    .getByLabel('Statistical question', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-inference-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Statistical question', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-inference-narrow.png') });
  await page.getByRole('button', { name: 'Return to descriptive view', exact: true }).click();
  await expect(page.getByText('Mean · 80 participants', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('selects a method, compares independent groups, and reopens every Welch channel', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?mask&export&roundtrip');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await page.getByText('Statistical question', { exact: true }).click();
  await page.getByLabel('Statistical method', { exact: true }).selectOption('welch');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('% signal change');
  await page
    .getByLabel('I declare comparable effects from independent participants.', { exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Apply Welch unequal-variance test', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: /population B/ })).toBeVisible();
  await page.getByLabel('Group by factor', { exact: true }).selectOption('group');
  await page.getByRole('button', { name: 'Show factor groups', exact: true }).click();
  await page
    .getByRole('region', { name: 'group: A', exact: true })
    .getByRole('button', { name: 'Use as A', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'group: B', exact: true })
    .getByRole('button', { name: 'Use as B', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Apply Welch unequal-variance test', exact: true })
    .click();
  await expect(
    page.getByText('Effect relative to null · A 40 / B 40 participants', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Actual observation · S001', { exact: true })).toBeVisible();
  const channel = page.getByLabel('Test result channel', { exact: true });
  await expect(channel.locator('option')).toHaveCount(6);
  for (const value of ['t', 'df', 'countA', 'countB']) {
    await channel.selectOption(value);
    await expect(page.getByLabel('Displayed test channel', { exact: true })).toHaveValue(value);
  }
  await page.getByRole('button', { name: 'Next observation', exact: true }).click();
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
    .getByLabel('Statistical question', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-welch-desktop.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByLabel('Statistical question', { exact: true })
    .screenshot({ path: testInfo.outputPath('population-welch-narrow.png') });
  await page.getByRole('button', { name: 'Return to descriptive view', exact: true }).click();
  await expect(page.getByText('Mean · 40 participants', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('matches paired participants, freezes pair counts and restores the question', async ({
  page,
}) => {
  await page.goto('/population-harness.html?mask&export&roundtrip&paired');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('column:participant');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await page.getByText('Statistical question', { exact: true }).click();
  await page.getByLabel('Statistical method', { exact: true }).selectOption('paired');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('a.u.');
  await page.getByLabel('I declare comparable effects from independent participants.').check();
  // Select a factor group as A; its complement contains the matching second condition.
  await page.getByLabel('Group by factor', { exact: true }).selectOption('group');
  await page.getByRole('button', { name: 'Show factor groups', exact: true }).click();

  await page.getByText('Choose comparison groups', { exact: true }).click();
  await page.getByLabel('Assign group to A', { exact: true }).selectOption('factor-0');
  await page.getByLabel('Assign group to B', { exact: true }).selectOption('factor-1');
  await page.getByRole('button', { name: 'Apply Paired test', exact: true }).click();
  await page.getByLabel('Test result channel', { exact: true }).selectOption('count');
  await expect(
    page.getByText('Valid pair count · A 40 / B 40 participants', { exact: true }),
  ).toBeVisible();
  await page.getByText('Save calculation', { exact: true }).click();
  await page.getByRole('button', { name: 'Freeze discovery…', exact: true }).click();
  const receipt = JSON.parse((await page.getByTestId('synthetic-export-receipt').textContent())!);
  expect(receipt.population.inference.method).toBe('paired');
  expect(receipt.population.aggregation.groups).toHaveLength(40);
  await page.getByRole('button', { name: 'Open saved population…', exact: true }).click();
  await expect(page.getByLabel('Test result channel', { exact: true })).toHaveValue('count');
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
  await page.getByRole('button', { name: 'Compose in Plot', exact: true }).click();
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
  await page.getByRole('button', { name: 'Compose in Plot', exact: true }).click();
  await plot.screenshot({ path: testInfo.outputPath('population-plot-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('declares an OLS covariate and exports the participant-keyed design', async ({
  page,
}, testInfo) => {
  await page.goto('/population-harness.html?mask&export&ols');
  await page.getByText(/^Analysis unit:/).click();
  await page.getByLabel('Participant identity', { exact: true }).selectOption('rows');
  await page.getByLabel('Population analysis unit', { exact: true }).selectOption('single');
  await page.getByText('Statistical question', { exact: true }).click();
  await page.getByLabel('Statistical method', { exact: true }).selectOption('linearModel');
  await page.getByRole('checkbox', { name: 'age', exact: true }).check();
  await page.getByLabel('Model coefficient', { exact: true }).selectOption('age');
  await page.getByLabel('Coefficient units', { exact: true }).fill('a.u. / year');
  await page.getByLabel('Feature value role', { exact: true }).selectOption('effect');
  await page.getByLabel('Effect units', { exact: true }).fill('a.u.');
  await page
    .getByRole('checkbox', { name: 'I declare comparable effects from independent participants.' })
    .check();
  await page.getByRole('button', { name: 'Apply Linear model (OLS)', exact: true }).click();
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
  await page.getByRole('button', { name: 'Compose in Plot', exact: true }).click();
  await page.getByRole('button', { name: 'Compose in Plot', exact: true }).click();
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
  await page.getByRole('button', { name: 'Compose in Plot', exact: true }).click();
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
  await expect(
    page.getByText('Actual observation · S042 · frame 3', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Selected mean:/)).toContainText('1.000');
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
  await page.getByLabel('Group by factor', { exact: true }).selectOption('group');
  await page.getByLabel('Second grouping factor', { exact: true }).selectOption('site');
  await page.getByRole('button', { name: 'Show factor groups', exact: true }).click();
  const matrix = page.getByLabel('Population group matrix', { exact: true });
  await matrix.locator('summary').click();
  const cells = matrix.locator('tbody button');
  await expect(cells.first()).toBeEnabled();
  await cells.first().click();
  await expect(page.getByTestId('fixture-focus')).toHaveText('S001');
  await expect(page.getByText(/Selected mean:/)).toContainText('3.000');
  await matrix.screenshot({ path: testInfo.outputPath('population-group-matrix.png') });
});

test('renders a labeled reconstruction in the shared anatomical viewport', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/population-harness.html?export');
  await page.getByText('Spatial relationships', { exact: true }).click();
  await page.getByRole('button', { name: 'Fit on current support', exact: true }).click();
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
