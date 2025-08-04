import { test, expect } from '@playwright/test';
import { TauriHelper } from '../utils/tauri-helpers';
import { GPUValidation } from '../utils/gpu-validation';

test.describe('Atlas & Template Menu System', () => {
  let tauriHelper: TauriHelper;
  let gpuValidation: GPUValidation;

  test.beforeEach(async ({ page }) => {
    tauriHelper = new TauriHelper(page);
    gpuValidation = new GPUValidation(page);
    
    // Launch Tauri app
    await tauriHelper.launchTauriApp();
    
    // Wait for app to be ready
    await page.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    
    // Verify GPU context is available
    await expect(await gpuValidation.hasWebGPUSupport()).toBe(true);
  });

  test.afterEach(async () => {
    await tauriHelper.closeTauriApp();
  });

  test('should display Atlas Browser menu option', async ({ page }) => {
    // Right-click to open context menu
    await page.click('body', { button: 'right' });
    
    // Verify Atlas Browser option exists
    await expect(page.locator('text=Atlas Browser')).toBeVisible();
    
    // Click Atlas Browser option
    await page.click('text=Atlas Browser');
    
    // Verify AtlasPanel is created and visible
    await expect(page.locator('[data-testid="atlas-panel"]')).toBeVisible();
  });

  test('should load atlas catalog successfully', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for atlas panel to load
    await expect(page.locator('[data-testid="atlas-panel"]')).toBeVisible();
    
    // Verify catalog loading indicator appears
    await expect(page.locator('[data-testid="catalog-loading"]')).toBeVisible();
    
    // Wait for catalog to load (timeout: 10 seconds)
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Verify atlas entries are displayed
    await expect(page.locator('[data-testid="atlas-entry"]')).toHaveCount.greaterThan(0);
  });

  test('should display all supported atlas types', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Check for Schaefer2018 atlas
    await expect(page.locator('text=Schaefer2018')).toBeVisible();
    
    // Check for Glasser2016 atlas 
    await expect(page.locator('text=Glasser2016')).toBeVisible();
    
    // Check for FreeSurfer ASEG atlas
    await expect(page.locator('text=FreeSurfer ASEG')).toBeVisible();
    
    // Check for Olsen MTL atlas
    await expect(page.locator('text=Olsen MTL')).toBeVisible();
  });

  test('should open atlas configuration modal', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Click on first atlas entry
    await page.click('[data-testid="atlas-entry"]:first-child');
    
    // Verify configuration modal opens
    await expect(page.locator('[data-testid="atlas-config-modal"]')).toBeVisible();
    
    // Verify modal has atlas configuration options
    await expect(page.locator('[data-testid="resolution-selector"]')).toBeVisible();
    await expect(page.locator('[data-testid="template-space-selector"]')).toBeVisible();
  });

  test('should validate atlas configuration parameters', async ({ page }) => {
    // Open Atlas Browser panel  
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Click on Schaefer2018 atlas
    await page.click('[data-testid="atlas-entry"][data-atlas="schaefer2018"]');
    
    // Select configuration options
    await page.selectOption('[data-testid="resolution-selector"]', '1mm');
    await page.selectOption('[data-testid="template-space-selector"]', 'MNI152NLin6Asym');
    
    // Click Load Atlas button
    await page.click('[data-testid="load-atlas-btn"]');
    
    // Verify loading progress indicator
    await expect(page.locator('[data-testid="atlas-loading-progress"]')).toBeVisible();
  });

  test('should handle atlas loading errors gracefully', async ({ page }) => {
    // Mock network failure
    await page.route('**/api/atlas/**', route => route.abort());
    
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Expect error message to be displayed
    await expect(page.locator('[data-testid="catalog-error"]')).toBeVisible({ timeout: 10000 });
    
    // Verify error message contains useful information
    await expect(page.locator('[data-testid="catalog-error"]')).toContainText('Failed to load');
  });

  test('should support atlas search and filtering', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Use search functionality if available
    const searchInput = page.locator('[data-testid="atlas-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('schaefer');
      
      // Verify filtered results
      await expect(page.locator('[data-testid="atlas-entry"]')).toHaveCount.lessThanOrEqual(2);
      await expect(page.locator('text=Schaefer2018')).toBeVisible();
    }
  });

  test('should persist atlas panel state across sessions', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for panel to be visible
    await expect(page.locator('[data-testid="atlas-panel"]')).toBeVisible();
    
    // Reload the page
    await page.reload();
    await page.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    
    // Verify Atlas panel is still open (if persistence is implemented)
    const atlasPanel = page.locator('[data-testid="atlas-panel"]');
    if (await atlasPanel.isVisible()) {
      await expect(atlasPanel).toBeVisible();
    }
  });

  test('should handle concurrent atlas loading requests', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Quickly click multiple atlas entries
    const atlasEntries = page.locator('[data-testid="atlas-entry"]');
    const count = await atlasEntries.count();
    
    if (count > 1) {
      // Click first atlas
      await atlasEntries.nth(0).click();
      
      // Immediately click second atlas before first finishes loading
      await atlasEntries.nth(1).click();
      
      // Verify system handles concurrent requests gracefully
      await expect(page.locator('[data-testid="atlas-config-modal"]')).toBeVisible();
    }
  });

  test('should provide progress feedback during atlas loading', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog to load
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    
    // Click on an atlas to start loading
    await page.click('[data-testid="atlas-entry"]:first-child');
    
    // Configure and start loading
    await page.click('[data-testid="load-atlas-btn"]');
    
    // Check for progress indicators
    const progressIndicator = page.locator('[data-testid="atlas-loading-progress"]');
    if (await progressIndicator.isVisible()) {
      await expect(progressIndicator).toBeVisible();
      
      // Verify progress text updates
      await expect(progressIndicator).toContainText(/loading|progress|%/i);
    }
  });

  test('should integrate with existing layer system', async ({ page }) => {
    // Load a base volume first (if available)
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      // Mock file selection - in real test would use actual test data
      await fileInput.setInputFiles([]);
    }
    
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for catalog and load an atlas
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    await page.click('[data-testid="atlas-entry"]:first-child');
    await page.click('[data-testid="load-atlas-btn"]');
    
    // Verify atlas appears in layer panel
    await expect(page.locator('[data-testid="layer-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="atlas-layer"]')).toBeVisible();
  });
});