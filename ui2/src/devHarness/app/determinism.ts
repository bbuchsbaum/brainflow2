/**
 * Dev-only determinism controls for the full-app harness (app-harness.html).
 *
 * Installed before the real app modules are imported so module-level IDs,
 * timestamps and random draws are reproducible between captures.
 */

/** Fixed wall-clock origin: 2026-01-15T12:00:00Z. */
export const HARNESS_EPOCH_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Remove every persisted key so persisted Zustand stores start from defaults. */
export function clearBrowserStorage(): void {
  try {
    window.localStorage.clear();
  } catch {
    /* storage unavailable: defaults apply anyway */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/**
 * Freeze the clock and seed randomness.
 *
 * `Date.now()` / `new Date()` advance with `performance.now()` from a fixed
 * epoch rather than standing still: several services throttle on elapsed
 * wall-clock time and would stall if time never moved. Rendered timestamps are
 * therefore stable at second granularity, which is what the UI displays.
 */
export function installDeterminism(seed = 0x5eed): void {
  const random = mulberry32(seed);
  Math.random = random;

  let uuidCounter = 0;
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj) {
    const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
      uuidCounter += 1;
      const tail = uuidCounter.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${tail}`;
    };
    try {
      Object.defineProperty(cryptoObj, 'randomUUID', { value: randomUUID, configurable: true });
    } catch {
      /* non-configurable in this engine; app falls back to Math.random paths */
    }
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
      }
      return array;
    };
    try {
      Object.defineProperty(cryptoObj, 'getRandomValues', {
        value: getRandomValues,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  }

  const perfOrigin = performance.now();
  const harnessNow = () => HARNESS_EPOCH_MS + Math.floor(performance.now() - perfOrigin);
  const RealDate = Date;
  class HarnessDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(harnessNow());
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        super(...(args as [any]));
      }
    }
    static now(): number {
      return harnessNow();
    }
  }
  (globalThis as unknown as { Date: DateConstructor }).Date = HarnessDate as DateConstructor;
}
