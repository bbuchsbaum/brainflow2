/**
 * Dev-only helpers. These are no-ops in production builds.
 */

export function assertNoRenderPhaseWrites<T>(name: string, getter: () => T) {
  try {
    if (!(import.meta as any).env?.DEV) return;
    const a = getter();
    const b = getter();
    if (a !== b) {
      // eslint-disable-next-line no-console
      console.error(`[${name}] Snapshot changed between reads in one render. Likely a render-phase store write.`);
    }
  } catch {
    // Swallow to avoid impacting production or throwing in unusual environments
  }
}

