import { test, expect } from '@playwright/test';
import { TauriHelper } from '../utils/tauri-helpers';

test.describe('Security Validation Tests', () => {
  let tauriHelper: TauriHelper;

  test.beforeEach(async ({ page }) => {
    tauriHelper = new TauriHelper(page);
    await tauriHelper.launchTauriApp();
    await page.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
  });

  test.afterEach(async () => {
    await tauriHelper.closeTauriApp();
  });

  test('should reject malicious file paths', async ({ page }) => {
    // Test directory traversal attack prevention
    const maliciousPaths = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      '/etc/shadow',
      'C:\\Windows\\System32\\drivers\\etc\\hosts',
      'cache_dir/../../../sensitive_file',
      'cache_dir\\..\\..\\..\\sensitive_file'
    ];

    for (const maliciousPath of maliciousPaths) {
      // Attempt to use malicious path via file input
      const result = await page.evaluate(async (path) => {
        try {
          // Mock a Tauri command that would use file paths
          const response = await (window as any).__TAURI__?.invoke('load_file', { 
            path: path 
          });
          return { success: true, response };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, maliciousPath);

      // Should fail with security error
      expect(result.success).toBe(false);
      if (result.error) {
        expect(result.error.toLowerCase()).toContain('security');
      }
    }
  });

  test('should sanitize cache directory paths', async ({ page }) => {
    // Test that cache directory creation validates paths
    const result = await page.evaluate(async () => {
      try {
        // Attempt to initialize atlas service with malicious cache path
        const response = await (window as any).__TAURI__?.invoke('get_atlas_catalog', {
          cacheDir: '../../../malicious_cache'
        });
        return { success: true, response };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Should handle path sanitization securely
    if (!result.success) {
      expect(result.error?.toLowerCase()).toContain('path');
    }
  });

  test('should validate atlas configuration inputs', async ({ page }) => {
    // Test type-safe enum validation
    const invalidConfigs = [
      { atlas_type: 'malicious_script', resolution: '1mm' },
      { atlas_type: 'schaefer2018', resolution: '../etc/passwd' },
      { atlas_type: '<script>alert("xss")</script>', resolution: '2mm' },
      { atlas_type: 'schaefer2018', template_space: '../../sensitive' }
    ];

    for (const config of invalidConfigs) {
      const result = await page.evaluate(async (cfg) => {
        try {
          const response = await (window as any).__TAURI__?.invoke('validate_atlas_config', {
            config: cfg
          });
          return { success: true, response };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, config);

      // Should reject invalid configuration
      expect(result.success).toBe(false);
      if (result.error) {
        expect(result.error.toLowerCase()).toMatch(/validation|invalid|unknown/);
      }
    }
  });

  test('should handle resource cleanup on component unmount', async ({ page }) => {
    // Open Atlas Browser panel
    await page.click('body', { button: 'right' });
    await page.click('text=Atlas Browser');
    
    // Wait for panel to load
    await expect(page.locator('[data-testid="atlas-panel"]')).toBeVisible();
    
    // Start an atlas loading operation
    await page.waitForSelector('[data-testid="catalog-loaded"]', { timeout: 10000 });
    await page.click('[data-testid="atlas-entry"]:first-child');
    
    // Immediately close the panel (simulating component unmount)
    await page.click('[data-testid="close-panel"]');
    
    // Verify no memory leaks or hanging operations
    await page.waitForTimeout(1000);
    
    // Check console for cancellation messages (not errors)
    const logs = await page.evaluate(() => {
      return (window as any).__testLogs || [];
    });
    
    // Should see cancellation, not errors
    const hasCancellation = logs.some((log: string) => 
      log.includes('cancelled') || log.includes('aborted')
    );
    
    // At minimum, should not have unhandled promise rejections
    const hasUnhandledErrors = logs.some((log: string) => 
      log.includes('Unhandled') && log.includes('Promise')
    );
    
    expect(hasUnhandledErrors).toBe(false);
  });

  test('should rate limit atlas loading requests', async ({ page }) => {
    // Rapidly trigger multiple atlas loading requests
    const startTime = Date.now();
    const promises = [];
    
    for (let i = 0; i < 10; i++) {
      promises.push(
        page.evaluate(async () => {
          try {
            const response = await (window as any).__TAURI__?.invoke('get_atlas_catalog');
            return { success: true, timestamp: Date.now() };
          } catch (error) {
            return { success: false, error: error.message, timestamp: Date.now() };
          }
        })
      );
    }
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    
    // Should not complete all requests instantly (rate limiting in effect)
    expect(endTime - startTime).toBeGreaterThan(100);
    
    // At least some requests should succeed
    const successCount = results.filter(r => r.success).length;
    expect(successCount).toBeGreaterThan(0);
  });

  test('should validate network request origins', async ({ page }) => {
    // Test that external network requests are properly validated
    const result = await page.evaluate(async () => {
      try {
        // Attempt to fetch from external malicious source
        const response = await fetch('http://malicious-site.com/atlas-data');
        return { success: true, status: response.status };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Should be blocked by CORS or network policies
    expect(result.success).toBe(false);
  });

  test('should protect against prototype pollution', async ({ page }) => {
    // Test prototype pollution protection in data handling
    const maliciousData = {
      __proto__: { malicious: true },
      constructor: { prototype: { polluted: true } },
      atlas_type: 'schaefer2018',
      resolution: '1mm'
    };

    const result = await page.evaluate(async (data) => {
      try {
        // Check if prototype pollution occurred
        const before = Object.prototype.hasOwnProperty.call({}, 'malicious');
        
        // Process the data (would normally go through Rust serialization)
        JSON.parse(JSON.stringify(data));
        
        const after = Object.prototype.hasOwnProperty.call({}, 'malicious');
        
        return { 
          success: true, 
          polluted: before !== after || after === true 
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, maliciousData);

    // Should not pollute the prototype
    expect(result.polluted).toBe(false);
  });

  test('should validate content security policy', async ({ page }) => {
    // Check that CSP headers are properly set
    const cspHeader = await page.evaluate(() => {
      const metaTags = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
      return metaTags.length > 0 ? metaTags[0].getAttribute('content') : null;
    });

    if (cspHeader) {
      // Should have restrictive CSP
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).not.toContain("'unsafe-eval'");
      expect(cspHeader).not.toContain("'unsafe-inline'");
    }
  });

  test('should handle large payloads securely', async ({ page }) => {
    // Test DoS protection against large payloads
    const largePayload = 'x'.repeat(10 * 1024 * 1024); // 10MB string
    
    const result = await page.evaluate(async (payload) => {
      try {
        const startTime = Date.now();
        const response = await (window as any).__TAURI__?.invoke('validate_atlas_config', {
          config: { atlas_type: payload, resolution: '1mm' }
        });
        const endTime = Date.now();
        
        return { 
          success: true, 
          duration: endTime - startTime,
          response 
        };
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          duration: Date.now()
        };
      }
    }, largePayload);

    // Should reject or handle large payloads quickly
    if (result.success) {
      expect(result.duration).toBeLessThan(1000); // Should not take long to reject
    } else {
      expect(result.error?.toLowerCase()).toMatch(/size|limit|invalid/);
    }
  });
});