import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/services': path.resolve(__dirname, './src/services'),
      '@/stores': path.resolve(__dirname, './src/stores'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
    },
    // Ensure React is resolved correctly
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor groups out of the app chunk so
        // they cache independently and the initial parse is smaller. The
        // surface renderer (neurosurface + Three.js) is code-split separately
        // via React.lazy (SurfaceViewPanelLazy), so it is intentionally not
        // listed here — it must stay in its own on-demand chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('golden-layout')) return 'vendor-goldenlayout';
          if (id.includes('@visx') || id.includes('d3-')) return 'vendor-visx';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
  },
  optimizeDeps: {
    // Force pre-bundling of React to avoid issues
    include: ['react', 'react-dom', 'react-dom/client'],
  },
});
