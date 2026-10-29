import {defineConfig} from '@playwright/test';
import base from './playwright.browser.config';
export default defineConfig(base,{testMatch:'workspace-browser.spec.ts',outputDir:process.env.BROWSER_QA_OUTPUT ?? '../cruft/shared-workspace'});
