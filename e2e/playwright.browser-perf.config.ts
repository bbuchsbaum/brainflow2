import { defineConfig } from '@playwright/test';
import base from './playwright.browser.config';
export default defineConfig(base, {
  testMatch: 'browser-performance.spec.ts',
  timeout: 180_000,
  outputDir: process.env.BROWSER_QA_OUTPUT ?? '../cruft/browser-completion/performance',
});
