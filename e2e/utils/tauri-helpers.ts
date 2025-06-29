import { Page, Locator } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Wait for Tauri app to be fully loaded
 */
export async function waitForTauriApp(page: Page, timeout = 30000) {
  // Navigate to the app
  await page.goto('/', { waitUntil: 'networkidle' });
  
  // Wait for Tauri to be available
  await page.waitForFunction(() => {
    return (window as any).__TAURI__ !== undefined;
  }, { timeout });
  
  // Set up console log capturing
  await page.evaluate(() => {
    (window as any).__consoleLogs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      (window as any).__consoleLogs.push(args.join(' '));
      originalLog.apply(console, args);
    };
  });
  
  console.log('Tauri app loaded successfully');
}

/**
 * Capture a screenshot with a specific name
 */
export async function captureScreenshot(target: Page | Locator, name: string) {
  const screenshotDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await target.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved: ${screenshotPath}`);
  
  return screenshotPath;
}

/**
 * Load a test volume file
 */
export async function loadTestVolume(page: Page, volumePath: string) {
  // Method 1: Try using file input if available
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(volumePath);
    return;
  }
  
  // Method 2: Try using menu/toolbar
  const fileMenu = page.locator('[data-testid="file-menu"], [aria-label="File"]');
  if (await fileMenu.count() > 0) {
    await fileMenu.click();
    const openItem = page.locator('[data-testid="open-file"], [aria-label="Open"]');
    if (await openItem.count() > 0) {
      await openItem.click();
      // Handle file dialog (this is platform-specific and might need adjustment)
      await page.waitForTimeout(1000);
    }
  }
  
  // Method 3: Use Tauri command directly
  await page.evaluate(async (path) => {
    const { invoke } = (window as any).__TAURI__.core;
    try {
      const result = await invoke('load_file', { pathStr: path });
      console.log('Volume loaded via Tauri command:', result);
    } catch (error) {
      console.error('Error loading volume:', error);
    }
  }, volumePath);
}

/**
 * Get render statistics from the app
 */
export async function getRenderStats(page: Page) {
  return await page.evaluate(() => {
    // Try to get stats from the app's state or performance API
    const stats = {
      fps: 0,
      frameTime: 0,
      gpuMemory: 0,
    };
    
    // Check if app exposes performance stats
    const appStats = (window as any).__APP_STATS__;
    if (appStats) {
      return appStats;
    }
    
    // Try to calculate FPS from requestAnimationFrame
    return new Promise((resolve) => {
      let frameCount = 0;
      const startTime = performance.now();
      
      function countFrames() {
        frameCount++;
        if (performance.now() - startTime < 1000) {
          requestAnimationFrame(countFrames);
        } else {
          stats.fps = frameCount;
          stats.frameTime = 1000 / frameCount;
          resolve(stats);
        }
      }
      
      requestAnimationFrame(countFrames);
    });
  });
}

/**
 * Interact with layer controls
 */
export async function setLayerOpacity(page: Page, layerIndex: number, opacity: number) {
  const layerControl = page.locator(`[data-testid="layer-${layerIndex}-opacity"]`);
  if (await layerControl.count() > 0) {
    await layerControl.fill(opacity.toString());
  } else {
    // Try alternative method
    await page.evaluate(async (params) => {
      const { invoke } = (window as any).__TAURI__.core;
      try {
        await invoke('patch_layer', {
          layerId: `layer_${params.index}`,
          patch: { opacity: params.opacity }
        });
      } catch (error) {
        console.error('Error setting layer opacity:', error);
      }
    }, { index: layerIndex, opacity });
  }
}

/**
 * Wait for GPU rendering to complete
 */
export async function waitForRender(page: Page, timeout = 5000) {
  // Wait for any pending renders
  await page.waitForTimeout(100);
  
  // Wait for GPU sync if available
  await page.evaluate(() => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  });
}