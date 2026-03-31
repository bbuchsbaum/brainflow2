/**
 * Lazy debug logger utility
 *
 * Returns a logging function that only emits when
 * `localStorage.getItem('debug:<namespace>')` is truthy.
 * The flag is checked once and cached; call `resetDebugCache()` if you
 * toggle the flag at runtime and want the change to take effect immediately.
 */

const cache = new Map<string, boolean>();

export function createDebugLogger(namespace: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    let enabled = cache.get(namespace);
    if (enabled === undefined) {
      try {
        enabled = typeof localStorage !== 'undefined' &&
          Boolean(localStorage.getItem(`debug:${namespace}`));
      } catch {
        enabled = false;
      }
      cache.set(namespace, enabled);
    }
    if (enabled) {
      console.log(...args);
    }
  };
}

/** Clear cached flag lookups (call after toggling localStorage flags at runtime). */
export function resetDebugCache(): void {
  cache.clear();
}
