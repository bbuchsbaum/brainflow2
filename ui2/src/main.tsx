// Import polyfills before anything else
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.tsx';

console.log('[main.tsx] React app starting...');

// [perf] Startup baseline. `performance.now()` here is the time from page
// navigation to the JS bundle being downloaded, parsed, and evaluated this far
// (the cost dominated by initial bundle size). The first-paint marker after
// root.render() below captures time-to-first-frame. Compare before/after when
// code-splitting / lazy-loading the surface (Three.js) path.
const BF_NAV_TO_MAIN_MS = typeof performance !== 'undefined' ? performance.now() : 0;
console.log(`[perf][startup] nav -> main.tsx eval: ${BF_NAV_TO_MAIN_MS.toFixed(0)} ms`);

// Global render counter for debugging
if (typeof window !== 'undefined') {
  (window as any).__RENDER_COUNTS = new Map();
  (window as any).__logRender = (componentName: string) => {
    const counts = (window as any).__RENDER_COUNTS;
    const current = counts.get(componentName) || 0;
    counts.set(componentName, current + 1);

    // Only warn after 1000 renders to avoid false alarms during normal usage
    // (slider interactions can easily generate 50-100 renders)
    if (current > 1000) {
      console.error(`[RENDER LOOP] ${componentName} has rendered ${current + 1} times!`);
      if (current === 1001) {
        console.trace(`First loop detection for ${componentName}`);
      }
    }
  };
}

// Ensure React is fully loaded before creating root
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

console.log('[main.tsx] React version:', React.version);
console.log('[main.tsx] ReactDOM:', typeof ReactDOM);

const root = ReactDOM.createRoot(rootElement);

// Render the app
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// [perf] Two rAFs land after the browser has committed the first paint.
if (typeof requestAnimationFrame !== 'undefined' && typeof performance !== 'undefined') {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      console.log(`[perf][startup] nav -> first paint: ${performance.now().toFixed(0)} ms`),
    ),
  );
}
