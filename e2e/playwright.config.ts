import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially for Tauri
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Tauri app
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],
  
  use: {
    // Base URL for the Tauri app
    baseURL: 'http://localhost:1420',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Timeout for each test
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'Desktop App',
      use: {
        ...devices['Desktop Chrome'],
        // Custom launch options for Tauri
        launchOptions: {
          args: ['--no-sandbox'],
        },
      },
    },
  ],

  // Run Tauri dev server before tests
  webServer: {
    command: 'cd .. && cargo tauri dev',
    port: 1420,
    timeout: 120 * 1000, // 2 minutes to build and start
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // Output folder for test artifacts
  outputDir: 'test-results/',

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 5000,
    toHaveScreenshot: {
      // Screenshot comparison options
      maxDiffPixels: 100,
      threshold: 0.2,
    },
  },
});