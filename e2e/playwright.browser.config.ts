import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./harness', testMatch:'browser-host.spec.ts',workers:1,retries:0,timeout:60_000,
  reporter:'list',outputDir:'../cruft/browser-portability/playwright',
  use:{baseURL:'http://127.0.0.1:5358',viewport:{width:1440,height:900},trace:'retain-on-failure',
    launchOptions:{executablePath:process.env.BROWSER_QA_BROWSER,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist',...(process.platform==='darwin'?['--use-angle=metal']:[])]}},
  webServer:[
    {command:'node_modules/.bin/vite --config vite.browser.config.ts --host 127.0.0.1 --port 5358 --strictPort',cwd:resolve(__dirname,'../ui2'),url:'http://127.0.0.1:5358/browser.html',reuseExistingServer:false},
    {command:'node_modules/.bin/vite preview --config vite.browser.config.ts --host 127.0.0.1 --port 5359 --strictPort',cwd:resolve(__dirname,'../ui2'),url:'http://127.0.0.1:5359/browser.html',reuseExistingServer:false},
  ],
});
