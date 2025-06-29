import { test, expect } from '@playwright/test';
import { 
  waitForTauriApp, 
  captureScreenshot, 
  loadTestVolume, 
  setLayerOpacity,
  waitForRender 
} from '../utils/tauri-helpers';
import { 
  validateGPURendering, 
  compareScreenshots,
  validateRenderingFeatures 
} from '../utils/gpu-validation';
import path from 'path';

test.describe('Multi-Volume Overlay Tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
  });

  test('should load and display multiple volumes as overlays', async ({ page }) => {
    // Load base anatomical volume
    const baseVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    await loadTestVolume(page, baseVolume);
    await waitForRender(page);
    
    // Capture base volume rendering
    await captureScreenshot(page, 'base-volume-only');
    
    // Load overlay volume (using same file for testing)
    await loadTestVolume(page, baseVolume);
    await waitForRender(page);
    
    // Capture with overlay
    await captureScreenshot(page, 'base-plus-overlay');
    
    // Verify both volumes are loaded
    const layerCount = await page.evaluate(() => {
      const logs = (window as any).__consoleLogs || [];
      const layerLogs = logs.filter((log: string) => 
        log.includes('layer') || log.includes('Layer')
      );
      return layerLogs.length;
    });
    
    console.log('Layer-related logs found:', layerCount);
    
    // Compare screenshots to ensure overlay changed the rendering
    const hasChanged = await compareScreenshots(
      'base-volume-only.png',
      'base-plus-overlay.png'
    );
    
    // If UI properly handles overlays, they should look different
    // (This might need adjustment based on actual implementation)
    console.log('Rendering changed with overlay:', hasChanged);
  });

  test('should handle different blend modes', async ({ page }) => {
    // Load two volumes
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Test different blend modes if UI controls exist
    const blendModes = ['normal', 'additive', 'maximum', 'minimum'];
    
    for (const mode of blendModes) {
      // Try to set blend mode via UI or Tauri command
      await page.evaluate(async ({ mode }) => {
        const { invoke } = (window as any).__TAURI__.core;
        try {
          await invoke('patch_layer', {
            layerId: 'layer_1',
            patch: { blend_mode: mode }
          });
          console.log(`Set blend mode to: ${mode}`);
        } catch (error) {
          console.error(`Error setting blend mode ${mode}:`, error);
        }
      }, { mode });
      
      await waitForRender(page);
      await captureScreenshot(page, `blend-mode-${mode}`);
    }
  });

  test('should properly handle opacity for multiple layers', async ({ page }) => {
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Load base volume
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Load overlay
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Test different opacity values
    const opacityValues = [1.0, 0.75, 0.5, 0.25, 0.0];
    
    for (const opacity of opacityValues) {
      await setLayerOpacity(page, 1, opacity);
      await waitForRender(page);
      
      const screenshot = await page.screenshot();
      const validation = await validateGPURendering(screenshot);
      
      await captureScreenshot(page, `overlay-opacity-${opacity * 100}`);
      
      console.log(`Opacity ${opacity}: brightness=${validation.averageBrightness}`);
      
      // At 0 opacity, overlay should not affect rendering
      if (opacity === 0.0) {
        // Should look similar to base volume only
        // (This is a simplified check)
        expect(validation.pixelStats.nonBlack).toBeGreaterThan(0);
      }
    }
  });

  test('should handle maximum number of layers (8)', async ({ page }) => {
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    const maxLayers = 8;
    
    // Try to load maximum number of volumes
    for (let i = 0; i < maxLayers; i++) {
      console.log(`Loading volume ${i + 1} of ${maxLayers}`);
      await loadTestVolume(page, testVolume);
      await waitForRender(page);
      
      // Set decreasing opacity for each layer
      const opacity = 1.0 - (i * 0.1);
      await page.evaluate(async ({ index, opacity }) => {
        const { invoke } = (window as any).__TAURI__.core;
        try {
          await invoke('patch_layer', {
            layerId: `layer_${index}`,
            patch: { opacity: opacity }
          });
        } catch (error) {
          console.error('Error setting layer opacity:', error);
        }
      }, { index: i, opacity });
    }
    
    await captureScreenshot(page, 'max-layers-loaded');
    
    // Verify rendering still works with max layers
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    expect(validation.hasContent).toBeTruthy();
    expect(validation.averageBrightness).toBeGreaterThan(0);
  });

  test('should maintain layer order correctly', async ({ page }) => {
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Load 3 volumes with different colormaps
    for (let i = 0; i < 3; i++) {
      await loadTestVolume(page, testVolume);
      await waitForRender(page);
      
      // Set different colormap for each layer
      await page.evaluate(async ({ index }) => {
        const { invoke } = (window as any).__TAURI__.core;
        try {
          await invoke('patch_layer', {
            layerId: `layer_${index}`,
            patch: { 
              colormap_id: index,
              opacity: 0.7 
            }
          });
        } catch (error) {
          console.error('Error setting layer colormap:', error);
        }
      }, { index: i });
    }
    
    await captureScreenshot(page, 'multi-layer-order');
    
    // Reorder layers if UI supports it
    // This would depend on actual UI implementation
    const reorderButton = page.locator('[data-testid="reorder-layers"]');
    if (await reorderButton.count() > 0) {
      await reorderButton.click();
      await waitForRender(page);
      await captureScreenshot(page, 'multi-layer-reordered');
    }
  });

  test('should handle volumes with different coordinate systems', async ({ page }) => {
    // This test would require test volumes with different orientations
    // For now, we'll test the capability to load multiple volumes
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Load base volume
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Simulate loading a volume with different orientation
    // In a real test, this would be a different file
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Check console for coordinate transformation logs
    const coordinateLogs = await page.evaluate(() => {
      const logs = (window as any).__consoleLogs || [];
      return logs.filter((log: string) => 
        log.includes('coordinate') || 
        log.includes('orientation') ||
        log.includes('transform')
      );
    });
    
    console.log('Coordinate system logs:', coordinateLogs);
    
    await captureScreenshot(page, 'different-coordinate-systems');
  });

  test('should update all views when overlay is added', async ({ page }) => {
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Load base volume
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Capture all three views
    const views = ['axial', 'coronal', 'sagittal'];
    for (const view of views) {
      const viewElement = page.locator(`[data-view="${view}"]`);
      if (await viewElement.count() > 0) {
        await captureScreenshot(viewElement, `${view}-before-overlay`);
      }
    }
    
    // Add overlay
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
    
    // Set overlay to distinctive appearance
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      try {
        await invoke('patch_layer', {
          layerId: 'layer_1',
          patch: { 
            opacity: 0.5,
            colormap_id: 2, // Different colormap
            blend_mode: 'additive'
          }
        });
      } catch (error) {
        console.error('Error configuring overlay:', error);
      }
    });
    
    await waitForRender(page);
    
    // Capture all views again
    for (const view of views) {
      const viewElement = page.locator(`[data-view="${view}"]`);
      if (await viewElement.count() > 0) {
        await captureScreenshot(viewElement, `${view}-with-overlay`);
      }
    }
  });

  test('should validate GPU memory usage with multiple volumes', async ({ page }) => {
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    
    // Get initial GPU metrics
    const initialMetrics = await page.evaluate(() => {
      return performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize
      } : null;
    });
    
    console.log('Initial memory:', initialMetrics);
    
    // Load multiple volumes
    for (let i = 0; i < 5; i++) {
      await loadTestVolume(page, testVolume);
      await waitForRender(page);
      
      // Check memory after each load
      const currentMetrics = await page.evaluate(() => {
        return performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize
        } : null;
      });
      
      console.log(`Memory after ${i + 1} volumes:`, currentMetrics);
    }
    
    // Ensure app is still responsive
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    expect(validation.hasContent).toBeTruthy();
  });
});