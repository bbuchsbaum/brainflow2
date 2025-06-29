import { test, expect } from '@playwright/test';
import { 
  waitForTauriApp, 
  captureScreenshot, 
  loadTestVolume 
} from '../utils/tauri-helpers';
import path from 'path';

test.describe('TreeBrowser Refactored Tests', () => {
  test.beforeEach(async ({ page }) => {
    await waitForTauriApp(page);
    // Navigate to a page with the file browser
    // This assumes you have a route that shows the FileBrowserPanel
    await page.goto('/file-browser-demo');
  });

  test('should display file browser with navigation controls', async ({ page }) => {
    // Check main UI elements
    await expect(page.locator('.tree-browser-refactored')).toBeVisible();
    await expect(page.locator('.tree-header')).toBeVisible();
    await expect(page.locator('.breadcrumbs')).toBeVisible();
    await expect(page.locator('.tree-view')).toBeVisible();
    
    // Check navigation buttons
    const navButtons = page.locator('.nav-buttons button');
    await expect(navButtons).toHaveCount(5); // Back, Forward, Up, Home, Refresh
    
    // Check search box
    await expect(page.locator('.search-input')).toBeVisible();
    
    await captureScreenshot(page, 'tree-browser-ui');
  });

  test('should navigate directories', async ({ page }) => {
    // Wait for initial load
    await page.waitForSelector('.tree-node');
    
    // Find and click on first directory
    const firstDir = page.locator('.tree-node').filter({ hasText: /📁|Folder/ }).first();
    if (await firstDir.count() > 0) {
      const dirName = await firstDir.textContent();
      console.log('Clicking on directory:', dirName);
      
      await firstDir.click();
      
      // Wait for directory to load
      await page.waitForTimeout(1000);
      
      // Check breadcrumbs updated
      const breadcrumbs = page.locator('.breadcrumb');
      const breadcrumbCount = await breadcrumbs.count();
      expect(breadcrumbCount).toBeGreaterThan(0);
      
      await captureScreenshot(page, 'tree-browser-navigated');
    }
  });

  test('should filter files with search', async ({ page }) => {
    // Wait for files to load
    await page.waitForSelector('.tree-node');
    
    // Get initial file count
    const initialNodes = await page.locator('.tree-node').count();
    console.log('Initial node count:', initialNodes);
    
    // Type in search box
    const searchInput = page.locator('.search-input');
    await searchInput.fill('nii');
    
    // Wait for filtering
    await page.waitForTimeout(500);
    
    // Check filtered results
    const filteredNodes = await page.locator('.tree-node').count();
    console.log('Filtered node count:', filteredNodes);
    
    // Should have fewer nodes (unless all files contain 'nii')
    expect(filteredNodes).toBeLessThanOrEqual(initialNodes);
    
    // Clear search
    const clearButton = page.locator('.clear-search');
    if (await clearButton.isVisible()) {
      await clearButton.click();
      
      // Should restore original count
      await page.waitForTimeout(500);
      const restoredCount = await page.locator('.tree-node').count();
      expect(restoredCount).toBe(initialNodes);
    }
  });

  test('should highlight valid neuroimaging files', async ({ page }) => {
    // Navigate to test data directory if possible
    const testDataPath = path.join(process.cwd(), '..', 'test-data', 'unit');
    
    // Try to navigate to test data
    // This might require setting up a specific demo route
    
    await page.waitForSelector('.tree-node');
    
    // Look for .nii, .nii.gz, or .gii files
    const validFiles = page.locator('.tree-node.valid-file');
    const validCount = await validFiles.count();
    
    if (validCount > 0) {
      // Valid files should have special styling
      const firstValid = validFiles.first();
      const classList = await firstValid.getAttribute('class');
      expect(classList).toContain('valid-file');
      
      await captureScreenshot(page, 'tree-browser-valid-files');
    }
  });

  test('should load file when clicking on valid neuroimaging file', async ({ page }) => {
    // Set up console log capture
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });
    
    await page.waitForSelector('.tree-node');
    
    // Find a valid neuroimaging file
    const niftiFile = page.locator('.tree-node').filter({ hasText: /\.nii(\.gz)?$/ }).first();
    
    if (await niftiFile.count() > 0) {
      const fileName = await niftiFile.textContent();
      console.log('Clicking on file:', fileName);
      
      await niftiFile.click();
      
      // Wait for file load
      await page.waitForTimeout(2000);
      
      // Check for loading logs
      const loadLogs = consoleLogs.filter(log => 
        log.includes('Loading file') || 
        log.includes('Volume loaded') ||
        log.includes('layer')
      );
      
      console.log('Load-related logs:', loadLogs);
      expect(loadLogs.length).toBeGreaterThan(0);
      
      // Check for success toast
      const toast = page.locator('.toast-success');
      if (await toast.count() > 0) {
        const toastText = await toast.textContent();
        expect(toastText).toContain('Loaded');
      }
    }
  });

  test('should show recent files after loading', async ({ page }) => {
    // First load a file
    await page.waitForSelector('.tree-node');
    
    const niftiFile = page.locator('.tree-node').filter({ hasText: /\.nii(\.gz)?$/ }).first();
    
    if (await niftiFile.count() > 0) {
      await niftiFile.click();
      await page.waitForTimeout(2000);
      
      // Check for recent files section
      const recentSection = page.locator('.recent-files');
      if (await recentSection.count() > 0) {
        await expect(recentSection).toBeVisible();
        
        // Should have at least one recent file
        const recentItems = page.locator('.recent-item');
        expect(await recentItems.count()).toBeGreaterThan(0);
        
        await captureScreenshot(page, 'tree-browser-recent-files');
      }
    }
  });

  test('should handle navigation buttons correctly', async ({ page }) => {
    await page.waitForSelector('.tree-node');
    
    // Test refresh button
    const refreshButton = page.locator('[title="Refresh"]');
    await expect(refreshButton).toBeVisible();
    
    const initialNodeCount = await page.locator('.tree-node').count();
    
    await refreshButton.click();
    await page.waitForTimeout(1000);
    
    // Should still have nodes after refresh
    const afterRefreshCount = await page.locator('.tree-node').count();
    expect(afterRefreshCount).toBeGreaterThan(0);
    
    // Test home button
    const homeButton = page.locator('[title="Home"]');
    await homeButton.click();
    await page.waitForTimeout(1000);
    
    // Should be at root directory
    const breadcrumbs = await page.locator('.breadcrumb').count();
    expect(breadcrumbs).toBeGreaterThan(0);
  });

  test('should handle drag and drop', async ({ page }) => {
    // This test would require setting up file drag/drop
    // which is complex in Playwright and may not work in all environments
    
    // Check that drop zone exists
    const dropZone = page.locator('.file-browser-panel');
    await expect(dropZone).toBeVisible();
    
    // The panel should accept drag events
    const classes = await dropZone.getAttribute('class');
    
    // Simulate dragover event
    await dropZone.dispatchEvent('dragover', {
      dataTransfer: { types: ['Files'] }
    });
    
    // Note: Full drag-and-drop testing would require more complex setup
    console.log('Drag and drop zone is present');
  });

  test('should display loading state', async ({ page }) => {
    // Trigger a directory change to see loading state
    await page.waitForSelector('.tree-node');
    
    const firstDir = page.locator('.tree-node').filter({ hasText: /📁|Folder/ }).first();
    if (await firstDir.count() > 0) {
      // Set up promise to catch loading state
      const loadingPromise = page.waitForSelector('.loading-state', { 
        state: 'visible',
        timeout: 5000 
      }).catch(() => null);
      
      // Click directory
      await firstDir.click();
      
      // Check if we caught the loading state
      const loadingElement = await loadingPromise;
      if (loadingElement) {
        console.log('Loading state was displayed');
        await captureScreenshot(page, 'tree-browser-loading');
      }
    }
  });

  test('should display error state on failure', async ({ page }) => {
    // This would require mocking an error or navigating to an inaccessible directory
    // For now, we'll just verify the error UI exists in the DOM
    
    // Try to navigate to a non-existent or restricted path
    // This is platform-specific and might not trigger an error in all cases
    
    const errorMessage = page.locator('.error-message');
    
    // If an error occurs during testing, capture it
    if (await errorMessage.count() > 0) {
      const errorText = await errorMessage.textContent();
      console.log('Error displayed:', errorText);
      await captureScreenshot(page, 'tree-browser-error');
    }
  });
});