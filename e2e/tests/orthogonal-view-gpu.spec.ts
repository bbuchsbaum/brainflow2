import { test, expect } from '@playwright/test';
import { 
  waitForTauriApp, 
  captureScreenshot, 
  loadTestVolume,
  waitForRender,
  getRenderStats
} from '../utils/tauri-helpers';
import { 
  validateGPURendering,
  extractGPUMetrics,
  validateRenderingFeatures
} from '../utils/gpu-validation';
import path from 'path';

test.describe('Orthogonal View GPU Integration', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
  });

  test('should initialize GPU context for orthogonal views', async ({ page }) => {
    // Navigate to demo page
    await page.goto('/orthoview-demo');
    
    // Check for GPU initialization
    const gpuInitLogs = await page.evaluate(() => {
      const logs = (window as any).__consoleLogs || [];
      return logs.filter((log: string) => 
        log.includes('GPU context initialized') ||
        log.includes('Initializing shared GPU context')
      );
    });
    
    expect(gpuInitLogs.length).toBeGreaterThan(0);
    
    // Verify GPU is available
    const gpuMetrics = await extractGPUMetrics(page);
    expect(gpuMetrics.available).toBeTruthy();
  });

  test('should render volume in all three orthogonal views', async ({ page }) => {
    await page.goto('/orthoview-demo');
    
    // Load demo volume
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000); // Wait for loading
    
    // Check that all three views are present
    const axialCanvas = page.locator('[data-testid="canvas-axial"]');
    const coronalCanvas = page.locator('[data-testid="canvas-coronal"]');
    const sagittalCanvas = page.locator('[data-testid="canvas-sagittal"]');
    
    await expect(axialCanvas).toBeVisible();
    await expect(coronalCanvas).toBeVisible();
    await expect(sagittalCanvas).toBeVisible();
    
    // Capture screenshots of each view
    await captureScreenshot(axialCanvas, 'ortho-axial-view');
    await captureScreenshot(coronalCanvas, 'ortho-coronal-view');
    await captureScreenshot(sagittalCanvas, 'ortho-sagittal-view');
    
    // Validate each view has rendered content
    for (const [viewName, canvas] of [
      ['axial', axialCanvas],
      ['coronal', coronalCanvas],
      ['sagittal', sagittalCanvas]
    ]) {
      const screenshot = await canvas.screenshot();
      const validation = await validateGPURendering(screenshot);
      
      expect(validation.hasContent).toBeTruthy();
      expect(validation.averageBrightness).toBeGreaterThan(0);
      
      console.log(`${viewName} view validation:`, {
        hasContent: validation.hasContent,
        brightness: validation.averageBrightness,
        nonBlackPixels: validation.pixelStats.nonBlack
      });
    }
  });

  test('should synchronize crosshair across views', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Get initial crosshair position
    const initialCrosshair = await page.locator('.crosshair-info').textContent();
    console.log('Initial crosshair:', initialCrosshair);
    
    // Click on axial view to update crosshair
    const axialCanvas = page.locator('[data-testid="canvas-axial"]');
    await axialCanvas.click({ position: { x: 200, y: 200 } });
    await waitForRender(page);
    
    // Check crosshair updated
    const updatedCrosshair = await page.locator('.crosshair-info').textContent();
    console.log('Updated crosshair:', updatedCrosshair);
    
    expect(updatedCrosshair).not.toBe(initialCrosshair);
    
    // Capture all views after crosshair update
    await captureScreenshot(page, 'crosshair-synchronized');
  });

  test('should handle pan and zoom interactions', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    const axialCanvas = page.locator('[data-testid="canvas-axial"]');
    
    // Capture initial state
    await captureScreenshot(axialCanvas, 'ortho-initial-view');
    
    // Test zoom
    await axialCanvas.hover();
    await page.mouse.wheel(0, -100); // Zoom in
    await waitForRender(page);
    await captureScreenshot(axialCanvas, 'ortho-zoomed-in');
    
    // Test pan
    await axialCanvas.hover({ position: { x: 100, y: 100 } });
    await page.mouse.down();
    await page.mouse.move(200, 200);
    await page.mouse.up();
    await waitForRender(page);
    await captureScreenshot(axialCanvas, 'ortho-panned');
    
    // Verify the view changed
    const validation1 = await validateGPURendering(
      await page.screenshot({ path: 'ortho-initial-view.png' })
    );
    const validation2 = await validateGPURendering(
      await page.screenshot({ path: 'ortho-panned.png' })
    );
    
    // The brightness distribution should be different after pan/zoom
    expect(Math.abs(validation1.averageBrightness - validation2.averageBrightness)).toBeGreaterThan(0.01);
  });

  test('should maintain consistent rendering performance', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Measure render performance
    const frameTimes: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const startTime = Date.now();
      
      // Trigger render by changing crosshair
      await page.keyboard.press('ArrowRight');
      await waitForRender(page);
      
      const endTime = Date.now();
      frameTimes.push(endTime - startTime);
    }
    
    // Calculate average frame time
    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    console.log('Average frame time:', avgFrameTime, 'ms');
    console.log('Frame times:', frameTimes);
    
    // Should maintain reasonable performance (< 100ms per frame)
    expect(avgFrameTime).toBeLessThan(100);
    
    // Check consistency (no major spikes)
    const maxFrameTime = Math.max(...frameTimes);
    expect(maxFrameTime).toBeLessThan(200);
  });

  test('should handle view synchronization toggle', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Check sync is enabled by default
    const syncCheckbox = page.locator('input[type="checkbox"]');
    await expect(syncCheckbox).toBeChecked();
    
    // Zoom in on axial view
    const axialCanvas = page.locator('[data-testid="canvas-axial"]');
    await axialCanvas.hover();
    await page.mouse.wheel(0, -100);
    await waitForRender(page);
    
    // With sync enabled, all views should update
    await captureScreenshot(page, 'views-synchronized-zoom');
    
    // Disable sync
    await syncCheckbox.uncheck();
    
    // Zoom in on coronal view only
    const coronalCanvas = page.locator('[data-testid="canvas-coronal"]');
    await coronalCanvas.hover();
    await page.mouse.wheel(0, -100);
    await waitForRender(page);
    
    // Only coronal view should be zoomed now
    await captureScreenshot(page, 'views-independent-zoom');
  });

  test('should display correct orientation markers', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Check orientation markers for each view
    const views = [
      { type: 'axial', markers: ['A', 'P', 'R', 'L'] },
      { type: 'coronal', markers: ['S', 'I', 'R', 'L'] },
      { type: 'sagittal', markers: ['S', 'I', 'P', 'A'] }
    ];
    
    for (const view of views) {
      const viewElement = page.locator(`[data-view-type="${view.type}"]`);
      
      for (const marker of view.markers) {
        const markerElement = viewElement.locator(`.marker:has-text("${marker}")`);
        await expect(markerElement).toBeVisible();
      }
    }
    
    await captureScreenshot(page, 'orientation-markers-visible');
  });

  test('should handle GPU resource cleanup on navigation', async ({ page }) => {
    await page.goto('/orthoview-demo');
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Check for cleanup logs when navigating away
    page.on('console', msg => {
      if (msg.text().includes('GPU resources') || msg.text().includes('cleanup')) {
        console.log('Cleanup log:', msg.text());
      }
    });
    
    // Navigate away
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Navigate back
    await page.goto('/orthoview-demo');
    
    // Should be able to reinitialize without issues
    await page.click('button:has-text("Load Demo Volume")');
    await page.waitForTimeout(3000);
    
    // Verify rendering still works
    const axialCanvas = page.locator('[data-testid="canvas-axial"]');
    const screenshot = await axialCanvas.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    expect(validation.hasContent).toBeTruthy();
  });
});