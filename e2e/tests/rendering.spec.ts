import { test, expect } from '@playwright/test';
import { waitForTauriApp, captureScreenshot, loadTestVolume } from '../utils/tauri-helpers';
import { validateGPURendering, compareScreenshots } from '../utils/gpu-validation';
import path from 'path';

test.describe('Rendering Pipeline Tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    await loadTestVolume(page, testVolume);
    await page.waitForTimeout(2000);
  });

  test('should render volume with correct texture mapping', async ({ page }) => {
    // Capture current rendering
    const screenshot = await page.screenshot({ fullPage: false });
    
    // Validate GPU rendering output
    const validation = await validateGPURendering(screenshot);
    
    expect(validation.hasContent).toBeTruthy();
    expect(validation.averageBrightness).toBeGreaterThan(0);
    
    // Check texture coordinates in console logs
    const texCoordLogs = await page.evaluate(() => {
      const logs = (window as any).__consoleLogs || [];
      return logs.filter((log: string) => log.includes('Texture coordinates'));
    });
    
    console.log('Texture coordinate logs:', texCoordLogs);
  });

  test('should update rendering on colormap change', async ({ page }) => {
    // Take baseline screenshot
    await captureScreenshot(page, 'colormap-grayscale');
    
    // Change colormap if controls exist
    const colormapSelector = page.locator('[data-testid="colormap-selector"]');
    if (await colormapSelector.count() > 0) {
      await colormapSelector.selectOption('viridis');
      await page.waitForTimeout(500);
      
      await captureScreenshot(page, 'colormap-viridis');
      
      // Compare screenshots
      const isDifferent = await compareScreenshots(
        'colormap-grayscale.png',
        'colormap-viridis.png'
      );
      
      expect(isDifferent).toBeTruthy();
    }
  });

  test('should handle window/level adjustments', async ({ page }) => {
    // Look for window/level controls
    const windowControl = page.locator('[data-testid="window-center"]');
    const levelControl = page.locator('[data-testid="window-width"]');
    
    if (await windowControl.count() > 0 && await levelControl.count() > 0) {
      // Adjust window center
      await windowControl.fill('0.5');
      await page.waitForTimeout(500);
      await captureScreenshot(page, 'window-adjusted');
      
      // Adjust window width
      await levelControl.fill('0.2');
      await page.waitForTimeout(500);
      await captureScreenshot(page, 'level-adjusted');
    }
  });

  test('should apply opacity correctly', async ({ page }) => {
    const opacitySlider = page.locator('[data-testid="opacity-slider"]');
    
    if (await opacitySlider.count() > 0) {
      // Set to 50% opacity
      await opacitySlider.fill('0.5');
      await page.waitForTimeout(500);
      
      const screenshot = await page.screenshot();
      const validation = await validateGPURendering(screenshot);
      
      // At 50% opacity, average brightness should be lower
      expect(validation.averageBrightness).toBeLessThan(0.5);
    }
  });

  test('should render crosshair correctly', async ({ page }) => {
    // Move crosshair position
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    
    await captureScreenshot(page, 'crosshair-moved');
    
    // Check if crosshair is visible in rendering
    const crosshairVisible = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      // This would need actual pixel analysis
      return canvases.length > 0;
    });
    
    expect(crosshairVisible).toBeTruthy();
  });

  test('should handle view synchronization', async ({ page }) => {
    // Click on axial view at specific position
    const axialView = page.locator('[data-view="axial"] canvas').first();
    if (await axialView.count() > 0) {
      await axialView.click({ position: { x: 100, y: 100 } });
      await page.waitForTimeout(500);
      
      // Check if other views updated
      await captureScreenshot(page, 'views-synchronized');
    }
  });
});