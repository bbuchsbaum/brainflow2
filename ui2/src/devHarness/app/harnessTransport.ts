/**
 * Deterministic in-browser stand-in for the Tauri backend.
 *
 * - zero latency (handlers resolve on the microtask queue),
 * - fixed IDs (the backend model allocates them from counters),
 * - every command without a handler is recorded in `__harnessLog.unknown`
 *   and resolves to `null`, which the app treats as "nothing there".
 */
import type { BackendTransport } from '@/services/transport';
import { harnessLog } from './harnessLog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (args: any) => unknown;

const PLUGIN_PREFIX = 'plugin:api-bridge|';

export class HarnessTransport implements BackendTransport {
  private readonly handlers: Record<string, Handler>;

  constructor(handlers: Record<string, Handler>) {
    this.handlers = handlers;
  }

  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    return this.dispatch(cmd, args, 'transport') as Promise<T>;
  }

  async dispatch(rawCmd: string, args: unknown, via: 'transport' | 'internals'): Promise<unknown> {
    const cmd = rawCmd.startsWith(PLUGIN_PREFIX) ? rawCmd.slice(PLUGIN_PREFIX.length) : rawCmd;
    const log = harnessLog();
    log.calls.push({ cmd, via });
    log.pending += 1;
    try {
      const handler = this.handlers[cmd];
      if (!handler) {
        if (!log.unknown.includes(cmd)) log.unknown.push(cmd);
        return null;
      }
      return await handler(args ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.errors.push({ cmd, message });
      throw error;
    } finally {
      log.pending -= 1;
    }
  }
}

/**
 * Route `@tauri-apps/api/core`'s `invoke` (used directly by a handful of
 * services and by Tauri plugins) into the same transport. Tauri v2's `invoke`
 * delegates to `window.__TAURI_INTERNALS__.invoke(cmd, args, options)`.
 *
 * `window.__TAURI__` is deliberately left unset so `eventUtils` stays in its
 * no-op web mode and nothing tries to attach Tauri event listeners.
 */
export function installTauriInternalsShim(transport: HarnessTransport): void {
  let callbackId = 0;
  const internals = {
    invoke: (cmd: string, args?: unknown) => transport.dispatch(cmd, args, 'internals'),
    transformCallback: () => {
      callbackId += 1;
      return callbackId;
    },
    unregisterCallback: () => undefined,
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    plugins: {},
  };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = internals;
}
