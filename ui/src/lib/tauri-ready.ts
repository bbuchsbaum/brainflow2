// Helper to ensure Tauri is ready before making API calls
let tauriReady = false;
let readyPromise: Promise<void> | null = null;

export function waitForTauri(): Promise<void> {
    if (tauriReady) {
        return Promise.resolve();
    }
    
    if (readyPromise) {
        return readyPromise;
    }
    
    readyPromise = new Promise((resolve) => {
        const checkTauri = () => {
            // Check if Tauri internals are available
            if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
                tauriReady = true;
                resolve();
            } else {
                // Retry after a short delay
                setTimeout(checkTauri, 10);
            }
        };
        
        // Start checking
        checkTauri();
    });
    
    return readyPromise;
}

// Also check if we're in a Tauri environment
export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}