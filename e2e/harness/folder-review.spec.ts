import { test, expect } from '@playwright/test';

for (const layout of [
  { width: 1100, height: 850 },
  { width: 460, height: 640 },
]) {
  test(`review and open a selected folder at ${layout.width}px`, async ({ page }, info) => {
    await page.setViewportSize(layout);
    await page.goto('/folder-review-harness.html');
    await page.getByRole('button', { name: 'Open selected folder in Set studio…' }).click();
    await expect(page.getByRole('button', { name: 'Open set', exact: true })).toBeEnabled();
    await expect(page.getByText('2 members · 3 images')).toBeVisible();
    await expect(page.getByText('Missing', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open set' })).toBeVisible();
    const button = page.getByRole('button', { name: 'Open set', exact: true });
    const bounds = await button.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(layout.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('folder-review.png') });
    await page.getByRole('button', { name: '1001, rsa-A.nii.gz: Available', exact: true }).click();
    await expect(page.getByLabel('Image source')).toContainText(
      '/scratch/brad/high/full/1001/rsa-A.nii.gz',
    );
    await button.click();
    await expect(page.getByTestId('active-study')).toHaveText('Opened: study-regex-preview');
  });
}

test('cancel ignores late discovery', async ({ page }) => {
  await page.goto('/folder-review-harness.html?slow');
  await page.getByRole('button', { name: 'Open selected folder in Set studio…' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('active-study')).toHaveText('No study replaced');
  await page.waitForTimeout(1400);
  await expect(page.getByTestId('active-study')).toHaveText('No study replaced');
});

for (const mode of ['truncated', 'disconnected']) {
  test(`${mode} review stays recoverable`, async ({ page }, info) => {
    await page.goto(`/folder-review-harness.html?${mode}`);
    await page.getByRole('button', { name: 'Open selected folder in Set studio…' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open set', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`${mode}.png`) });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('active-study')).toHaveText('No study replaced');
  });
}

test('changed assignments require a new review before opening', async ({ page }) => {
  await page.goto('/folder-review-harness.html?changed');
  await page.getByRole('button', { name: 'Open selected folder in Set studio…' }).click();
  await page.getByRole('button', { name: 'Open set', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('files changed');
  await expect(page.getByRole('button', { name: 'Open set', exact: true })).toBeDisabled();
});
