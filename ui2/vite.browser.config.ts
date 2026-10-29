import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { resolve } from 'node:path';

export default mergeConfig(
  base,
  defineConfig({
    base: './',
    build: { outDir: 'dist-browser', rollupOptions: { input: { browser: resolve(__dirname, 'browser.html'), workspace: resolve(__dirname, 'workspace.html') } } },
    worker: { format: 'es' },
  }),
);
