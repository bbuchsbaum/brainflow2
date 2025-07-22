import { test, expect } from '@playwright/test';

test('verify intensity range is set from actual data', async ({ page }) => {
  // Navigate to the app
  await page.goto('http://localhost:5174');
  
  // Wait for app to load
  await page.waitForTimeout(2000);
  
  // Inject console log monitoring
  await page.evaluate(() => {
    // Store original console.log
    const originalLog = console.log;
    
    // Override console.log to capture intensity values
    console.log = (...args) => {
      originalLog(...args);
      
      // Check for intensity range logs
      const logStr = args.join(' ');
      if (logStr.includes('intensity:') || logStr.includes('Intensity:')) {
        // Extract intensity values
        const match = logStr.match(/\[(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]/);
        if (match) {
          const min = parseFloat(match[1]);
          const max = parseFloat(match[2]);
          
          // Check if it's the default range
          if (min === 0 && max === 100) {
            window.__intensityIsDefault = true;
            originalLog('❌ TEST FAILED: Default intensity range detected!');
          } else {
            window.__intensityIsDefault = false;
            originalLog('✅ TEST PASSED: Custom intensity range applied:', min, max);
          }
        }
      }
    };
  });
  
  // Simulate loading a NIfTI file
  // This would be done through the UI in a real test
  await page.evaluate(async () => {
    // Assuming there's a test file available
    const testFile = '/path/to/test.nii';
    
    // Trigger file load through the service
    const volumeService = (window as any).__volumeService;
    if (volumeService) {
      await volumeService.loadVolumeFromPath(testFile);
    }
  });
  
  // Wait for file to load and check result
  await page.waitForTimeout(3000);
  
  // Check if intensity was set correctly
  const intensityIsDefault = await page.evaluate(() => (window as any).__intensityIsDefault);
  expect(intensityIsDefault).toBe(false);
});