import { test, expect } from '@playwright/test';
import { waitForTauriApp, captureScreenshot, loadTestVolume } from '../utils/tauri-helpers';
import path from 'path';

test.describe('Volume Loading Tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
  });

  test('should load a test NIFTI volume', async ({ page }) => {
    // Path to test volume
    const testVolumePath = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Load volume using the app's file loading mechanism
    await loadTestVolume(page, testVolumePath);
    
    // Wait for volume to load
    await page.waitForTimeout(2000);
    
    // Take screenshot after loading
    await captureScreenshot(page, 'volume-loaded');
    
    // Check for volume info display
    const volumeInfo = page.locator('[data-testid="volume-info"]');
    if (await volumeInfo.count() > 0) {
      await expect(volumeInfo).toContainText('10x10x10'); // toy_t1w dimensions
    }
    
    // Check that canvases have been updated (non-black pixels)
    const canvasHasContent = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      for (const canvas of canvases) {
        const ctx = (canvas as HTMLCanvasElement).getContext('2d');
        if (!ctx) continue;
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Check if any pixel is non-black
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
            return true;
          }
        }
      }
      return false;
    });
    
    expect(canvasHasContent).toBeTruthy();
  });

  test('should display volume in all three views', async ({ page }) => {
    const testVolumePath = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    await loadTestVolume(page, testVolumePath);
    await page.waitForTimeout(2000);
    
    // Take screenshots of each view
    const views = ['axial', 'coronal', 'sagittal'];
    
    for (const view of views) {
      const viewElement = page.locator(`[data-view="${view}"]`);
      if (await viewElement.count() > 0) {
        await captureScreenshot(viewElement, `${view}-view-loaded`);
      }
    }
    
    // Verify crosshair is visible
    const crosshairVisible = await page.evaluate(() => {
      // Check if crosshair rendering is working
      const logs = (window as any).__consoleLogs || [];
      return logs.some((log: string) => log.includes('crosshair'));
    });
    
    console.log('Crosshair visible:', crosshairVisible);
  });

  test('should handle multiple volume loading', async ({ page }) => {
    const testVolume1 = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    const testVolume2 = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz'); // Load same file as overlay
    
    // Load first volume
    await loadTestVolume(page, testVolume1);
    await page.waitForTimeout(1000);
    
    // Load second volume as overlay
    await loadTestVolume(page, testVolume2);
    await page.waitForTimeout(1000);
    
    await captureScreenshot(page, 'multi-volume-overlay');
    
    // Check layer controls if available
    const layerControls = page.locator('[data-testid="layer-controls"]');
    if (await layerControls.count() > 0) {
      const layerCount = await layerControls.locator('[data-testid="layer-item"]').count();
      expect(layerCount).toBe(2);
    }
  });
});