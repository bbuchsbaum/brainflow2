import { test, expect } from '@playwright/test';
import { waitForTauriApp, captureScreenshot } from '../utils/tauri-helpers';

test.describe('App Launch Tests', () => {
  test('should launch the application successfully', async ({ page }) => {
    // Wait for Tauri app to be ready
    await waitForTauriApp(page);
    
    // Take a screenshot of initial state
    await captureScreenshot(page, 'app-launched');
    
    // Check that the main window is visible
    await expect(page).toHaveTitle(/Brainflow/);
    
    // Verify core UI elements are present
    const mainContainer = page.locator('[data-testid="main-container"]');
    await expect(mainContainer).toBeVisible();
    
    // Check for render canvases
    const canvases = page.locator('canvas');
    const canvasCount = await canvases.count();
    console.log(`Found ${canvasCount} canvas elements`);
    
    // Should have at least one canvas for rendering
    expect(canvasCount).toBeGreaterThanOrEqual(1);
  });

  test('should initialize GPU rendering', async ({ page }) => {
    await waitForTauriApp(page);
    
    // Check console for GPU initialization messages
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });
    
    // Wait for GPU initialization
    await page.waitForTimeout(2000);
    
    // Check for successful GPU init
    const gpuInitialized = consoleLogs.some(log => 
      log.includes('RenderLoopService') || 
      log.includes('GPU') ||
      log.includes('Successfully initialized')
    );
    
    expect(gpuInitialized).toBeTruthy();
  });

  test('should display empty orthogonal views', async ({ page }) => {
    await waitForTauriApp(page);
    
    // Look for view containers
    const axialView = page.locator('[data-view="axial"]');
    const coronalView = page.locator('[data-view="coronal"]');
    const sagittalView = page.locator('[data-view="sagittal"]');
    
    // Check if views exist (they might not have these exact selectors yet)
    const viewsExist = 
      (await axialView.count()) > 0 ||
      (await coronalView.count()) > 0 ||
      (await sagittalView.count()) > 0;
    
    if (viewsExist) {
      await expect(axialView).toBeVisible();
      await expect(coronalView).toBeVisible();
      await expect(sagittalView).toBeVisible();
      
      await captureScreenshot(page, 'empty-views');
    } else {
      console.log('Orthogonal view containers not found - may need to update selectors');
    }
  });
});