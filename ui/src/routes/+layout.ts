// Disable SSR for Tauri compatibility
// Tauri apps run in a webview context where server-side rendering doesn't make sense
export const ssr = false;

// Enable prerendering for static content
export const prerender = true;