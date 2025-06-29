import { test, expect } from '@playwright/test';

test.describe('Tauri API Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the test page
    await page.goto('http://localhost:5173/api-test');
    
    // Wait for tests to complete (look for the summary text)
    await page.waitForSelector('text=/Completed:.*passed/', { timeout: 10000 });
  });

  test('all API tests should pass', async ({ page }) => {
    // Get the overall status
    const status = await page.textContent('.text-lg.font-semibold');
    console.log('Test Status:', status);
    
    // Check that we have successful tests
    expect(status).toContain('passed');
    
    // Get all test results
    const testResults = await page.$$eval('.space-y-2 > div', elements => 
      elements.map(el => ({
        name: el.querySelector('.font-semibold')?.textContent,
        status: el.classList.contains('bg-green-50') ? 'success' : 
                el.classList.contains('bg-red-50') ? 'error' : 'other',
        message: el.querySelector('.text-gray-600')?.textContent,
        error: el.querySelector('.text-red-600')?.textContent
      }))
    );
    
    console.log('Test Results:', JSON.stringify(testResults, null, 2));
    
    // Check each test
    for (const result of testResults) {
      if (result.status === 'error') {
        console.error(`Test failed: ${result.name}`, result.error);
      }
      expect(result.status).toBe('success');
    }
  });

  test('Tauri API module should load', async ({ page }) => {
    // Execute code in the page context
    const canImportTauri = await page.evaluate(async () => {
      try {
        await import('@tauri-apps/api/core');
        return true;
      } catch {
        return false;
      }
    });
    
    expect(canImportTauri).toBe(true);
  });

  test('window.__TAURI__ should not exist in v2', async ({ page }) => {
    const hasLegacyGlobal = await page.evaluate(() => '__TAURI__' in window);
    expect(hasLegacyGlobal).toBe(false);
  });
});