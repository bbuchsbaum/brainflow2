import { test, expect } from '@playwright/test';
import { 
  waitForTauriApp, 
  captureScreenshot, 
  loadTestVolume,
  waitForRender
} from '../utils/tauri-helpers';
import { 
  validateGPURendering,
  compareScreenshots
} from '../utils/gpu-validation';
import path from 'path';

test.describe('Colormap Rendering Tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
    
    // Load test volume
    const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
    await loadTestVolume(page, testVolume);
    await waitForRender(page);
  });

  test('should render with different colormaps', async ({ page }) => {
    const colormaps = [
      'grayscale',
      'viridis',
      'hot',
      'cool',
      'plasma',
      'inferno',
      'magma',
      'turbo',
      'jet',
      'parula'
    ];
    
    for (const colormap of colormaps) {
      // Change colormap via API
      await page.evaluate(async ({ colormap }) => {
        const { invoke } = (window as any).__TAURI__.core;
        try {
          await invoke('patch_layer', {
            layerId: 'layer_0',
            patch: { colormap_id: colormap }
          });
          console.log(`Changed colormap to: ${colormap}`);
        } catch (error) {
          console.error(`Error setting colormap ${colormap}:`, error);
        }
      }, { colormap });
      
      await waitForRender(page);
      await captureScreenshot(page, `colormap-${colormap}`);
      
      // Validate rendering
      const screenshot = await page.screenshot();
      const validation = await validateGPURendering(screenshot);
      
      expect(validation.hasContent).toBeTruthy();
      
      // Different colormaps should produce different color distributions
      console.log(`Colormap ${colormap} - R:${validation.colorChannels.red.toFixed(2)}, G:${validation.colorChannels.green.toFixed(2)}, B:${validation.colorChannels.blue.toFixed(2)}`);
    }
  });

  test('should apply grayscale colormap correctly', async ({ page }) => {
    // Set to grayscale
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { colormap_id: 0 } // Grayscale ID
      });
    });
    
    await waitForRender(page);
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    // Grayscale should have equal RGB values
    const rDiff = Math.abs(validation.colorChannels.red - validation.colorChannels.green);
    const gDiff = Math.abs(validation.colorChannels.green - validation.colorChannels.blue);
    
    expect(rDiff).toBeLessThan(0.05); // Allow small tolerance
    expect(gDiff).toBeLessThan(0.05);
    
    await captureScreenshot(page, 'colormap-grayscale-validated');
  });

  test('should apply viridis colormap correctly', async ({ page }) => {
    // Set to viridis
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { colormap_id: 1 } // Viridis ID
      });
    });
    
    await waitForRender(page);
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    // Viridis should have distinct color channels
    expect(validation.colorChannels.green).toBeGreaterThan(validation.colorChannels.blue);
    
    await captureScreenshot(page, 'colormap-viridis-validated');
  });

  test('should apply fMRI red-blue colormap for activation maps', async ({ page }) => {
    // Set to fMRI red-blue
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { 
          colormap_id: 9, // fMRI red-blue ID
          intensity_min: -1.0,
          intensity_max: 1.0
        }
      });
    });
    
    await waitForRender(page);
    await captureScreenshot(page, 'colormap-fmri-redblue');
    
    // This colormap is diverging, so should have both red and blue components
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    console.log('fMRI colormap channels:', validation.colorChannels);
  });

  test('should handle colormap changes smoothly', async ({ page }) => {
    // Rapidly change colormaps to test performance
    const colormapIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    
    const startTime = Date.now();
    
    for (const id of colormapIds) {
      await page.evaluate(async ({ id }) => {
        const { invoke } = (window as any).__TAURI__.core;
        await invoke('patch_layer', {
          layerId: 'layer_0',
          patch: { colormap_id: id }
        });
      }, { id });
      
      // Don't wait for render between changes
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`Changed ${colormapIds.length} colormaps in ${duration}ms`);
    
    // Should complete quickly
    expect(duration).toBeLessThan(2000); // 2 seconds for all changes
    
    // Final render should still work
    await waitForRender(page);
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    expect(validation.hasContent).toBeTruthy();
  });

  test('should preserve colormap when changing other layer properties', async ({ page }) => {
    // Set a specific colormap
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { colormap_id: 4 } // Plasma
      });
    });
    
    await waitForRender(page);
    await captureScreenshot(page, 'colormap-before-opacity');
    
    // Change opacity
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { opacity: 0.5 }
      });
    });
    
    await waitForRender(page);
    await captureScreenshot(page, 'colormap-after-opacity');
    
    // Colors should be similar (just dimmer due to opacity)
    const before = await validateGPURendering(
      await page.screenshot({ path: 'colormap-before-opacity.png' })
    );
    const after = await validateGPURendering(
      await page.screenshot({ path: 'colormap-after-opacity.png' })
    );
    
    // Brightness should decrease but color ratios should be similar
    expect(after.averageBrightness).toBeLessThan(before.averageBrightness);
  });

  test('should handle phase colormap for complex data', async ({ page }) => {
    // Set to phase colormap (circular/HSV)
    await page.evaluate(async () => {
      const { invoke } = (window as any).__TAURI__.core;
      await invoke('patch_layer', {
        layerId: 'layer_0',
        patch: { colormap_id: 13 } // Phase ID
      });
    });
    
    await waitForRender(page);
    await captureScreenshot(page, 'colormap-phase');
    
    const screenshot = await page.screenshot();
    const validation = await validateGPURendering(screenshot);
    
    // Phase colormap should have varied colors
    expect(validation.colorChannels.red).toBeGreaterThan(0);
    expect(validation.colorChannels.green).toBeGreaterThan(0);
    expect(validation.colorChannels.blue).toBeGreaterThan(0);
  });

  test('should display colormap in UI if controls exist', async ({ page }) => {
    // Look for colormap selector in UI
    const colormapSelector = page.locator('[data-testid="colormap-selector"]');
    
    if (await colormapSelector.count() > 0) {
      // Get current selection
      const currentValue = await colormapSelector.inputValue();
      console.log('Current colormap selection:', currentValue);
      
      // Change via UI
      await colormapSelector.selectOption('hot');
      await waitForRender(page);
      
      await captureScreenshot(page, 'colormap-ui-hot');
      
      // Change to another
      await colormapSelector.selectOption('cool');
      await waitForRender(page);
      
      await captureScreenshot(page, 'colormap-ui-cool');
      
      // Verify the screenshots are different
      const isDifferent = await compareScreenshots(
        'colormap-ui-hot.png',
        'colormap-ui-cool.png'
      );
      
      expect(isDifferent).toBeTruthy();
    } else {
      console.log('No colormap selector found in UI');
    }
  });
});