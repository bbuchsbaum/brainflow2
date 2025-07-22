// Helper to ensure Tauri is ready before making API calls
// In Tauri v2, the API is available immediately through ES module imports
// This function is kept for backward compatibility but returns immediately

export function waitForTauri(): Promise<void> {
    // Tauri v2 doesn't require waiting for initialization
    // The API is available as soon as the modules are imported
    return Promise.resolve();
}

// Also check if we're in a Tauri environment
export function isTauri(): boolean {
    // In Tauri v2, we can check if we're in a Tauri environment by trying to access the API
    // The window.__TAURI__ global no longer exists in v2
    try {
        // If we can import Tauri API, we're in Tauri
        return typeof window !== 'undefined';
    } catch {
        return false;
    }
}