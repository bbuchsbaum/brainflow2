// Import polyfills before anything else
import './polyfills';

import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('[main.tsx] React app starting...');

// Global render counter for debugging
if (typeof window !== 'undefined') {
  (window as any).__RENDER_COUNTS = new Map();
  (window as any).__logRender = (componentName: string) => {
    const counts = (window as any).__RENDER_COUNTS;
    const current = counts.get(componentName) || 0;
    counts.set(componentName, current + 1);
    
    if (current > 30) {
      console.error(`[RENDER LOOP] ${componentName} has rendered ${current + 1} times!`);
      if (current === 31) {
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
  </React.StrictMode>
)
