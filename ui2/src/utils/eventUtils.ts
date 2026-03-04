/**
 * eventUtils - Safe wrappers around Tauri event APIs.
 *
 * In non-Tauri (web) builds, these wrappers no-op and avoid throwing during
 * listener registration or cleanup. In Tauri builds, they delegate to
 * `@tauri-apps/api/event`.
 */

export type Unlisten = () => Promise<void> | void;

// Sentinel used to tag no-op unlisten functions returned in non-Tauri envs
const NOOP_TAG = Symbol('noop-unlisten');

function taggedNoop(): void {
  // intentional no-op
}
(taggedNoop as any)[NOOP_TAG as any] = true;

/** Returns a tagged no-op unlisten function. */
export function noopUnlisten(): Unlisten {
  return taggedNoop;
}

/** Check whether an unlisten function is a tagged no-op (non-Tauri fallback). */
export function isNoopUnlisten(fn: Unlisten | undefined | null): boolean {
  if (!fn) return true;
  return (fn as any)[NOOP_TAG as any] === true;
}

function isTauriEnv(): boolean {
  try {
    return typeof window !== 'undefined' && !!(window as any).__TAURI__;
  } catch {
    return false;
  }
}

export async function safeListen<T = any>(
  event: string,
  handler: (event: any) => void
): Promise<Unlisten> {
  if (!isTauriEnv()) {
    // Non-Tauri: return tagged no-op unlisten
    return noopUnlisten();
  }
  try {
    const mod = await import('@tauri-apps/api/event');
    return await mod.listen<T>(event, handler as any);
  } catch (err) {
    // In case internals are missing or plugin not loaded, quietly no-op
    console.warn('[eventUtils] Failed to listen to event in this environment:', { event, err });
    return noopUnlisten();
  }
}

export async function safeUnlisten(unlisten?: Promise<Unlisten> | Unlisten | null) {
  if (!unlisten) return;
  try {
    const fn = typeof unlisten === 'function' ? unlisten : await unlisten;
    if (typeof fn === 'function') {
      const p = fn();
      // Await promise-like results to catch plugin/runtime mismatches
      if (p && typeof (p as Promise<void>).then === 'function') {
        await (p as Promise<void>);
      }
    }
  } catch (err) {
    // If tauri internals are not available, ignore; otherwise log a warning once
    if (isTauriEnv()) {
      console.warn('[eventUtils] Failed to unlisten Tauri event:', err);
    }
  }
}

export async function safeEmit<T = any>(event: string, payload?: T) {
  if (!isTauriEnv()) return; // no-op in web builds
  try {
    const mod = await import('@tauri-apps/api/event');
    await mod.emit(event as any, payload as any);
  } catch (err) {
    console.warn('[eventUtils] Failed to emit Tauri event:', { event, err });
  }
}
