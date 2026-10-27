/**
 * Deterministic in-browser stand-in for the Tauri backend.
 *
 * - zero latency (handlers resolve on the microtask queue),
 * - fixed IDs (the backend model allocates them from counters),
 * - every command without a handler is recorded in `__harnessLog.unknown`
 *   and resolves to `null`, which the app treats as "nothing there".
 */
import type { BackendTransport, InvokeOptions } from '@/services/transport';
import { harnessLog } from './harnessLog';

/**
 * `args` is the JSON argument object, or the `Uint8Array` body of a raw-body
 * command, whose string arguments are then in `options.headers`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (args: any, options?: InvokeOptions) => unknown;

export type { InvokeOptions };

/** The raw body of a raw-body command; JSON bodies fail like the backend. */
export function rawBody(body: unknown, cmd: string): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error(
    `${cmd} expects the bytes as a raw Uint8Array body with arguments in x-brainflow-* headers, not a JSON object.`,
  );
}

/** A percent-encoded `x-brainflow-*` header, decoded; `undefined` when absent. */
export function rawHeader(options: InvokeOptions | undefined, name: string): string | undefined {
  const headers = options?.headers;
  const value =
    headers instanceof Headers
      ? (headers.get(name) ?? undefined)
      : Array.isArray(headers)
        ? headers.find(([key]) => key.toLowerCase() === name)?.[1]
        : (headers as Record<string, string> | undefined)?.[name];
  return value === undefined ? undefined : decodeURIComponent(value);
}

const PLUGIN_PREFIX = 'plugin:api-bridge|';

export class HarnessTransport implements BackendTransport {
  private readonly handlers: Record<string, Handler>;

  constructor(handlers: Record<string, Handler>) {
    this.handlers = handlers;
  }

  async invoke<T>(cmd: string, args?: unknown, options?: InvokeOptions): Promise<T> {
    return this.dispatch(cmd, args, 'transport', options) as Promise<T>;
  }

  async dispatch(
    rawCmd: string,
    args: unknown,
    via: 'transport' | 'internals',
    options?: InvokeOptions,
  ): Promise<unknown> {
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
      return await handler(args ?? {}, options);
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
    invoke: (cmd: string, args?: unknown, options?: InvokeOptions) =>
      transport.dispatch(cmd, args, 'internals', options),
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
