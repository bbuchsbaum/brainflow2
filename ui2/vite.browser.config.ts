import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { resolve } from 'node:path';

export default mergeConfig(
  base,
  defineConfig({
    base: './',
    build: { outDir: 'dist-browser', rollupOptions: { input: resolve(__dirname, 'browser.html') } },
    worker: { format: 'es' },
  }),
);
