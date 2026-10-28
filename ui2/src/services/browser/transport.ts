import type { BackendTransport } from '../transport';
import { browserCapabilities, UnsupportedBrowserCapability } from './protocol';
import type { WorkerReply, WorkerRequest } from './protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  clean: () => void;
}

/** One owner per viewer. File objects are cloned to the worker; frame buffers transfer back. */
export class BrowserTransport implements BackendTransport {
  readonly capabilities = browserCapabilities;
  onFailure?: (error: Error) => void;
  private serial = 0;
  private pending = new Map<number, Pending>();
  private disposed = false;
  private readonly worker: Worker;
  constructor(
    worker: Worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.fatal) {
        this.shutdown(new Error(data.error || 'Browser worker failed'));
        return;
      }
      const p = this.pending.get(data.id);
      if (!p) {
        worker.postMessage({ cancel: data.id } satisfies WorkerRequest);
        return;
      }
      this.pending.delete(data.id);
      p.clean();
      worker.postMessage({ ack: data.id } satisfies WorkerRequest);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.value);
    };
    worker.onerror = (event) => {
      this.shutdown(new Error(event.message || 'Browser worker failed'));
    };
    worker.onmessageerror = () => {
      this.shutdown(new Error('Browser worker response could not be decoded'));
    };
  }

  invoke<T>(cmd: string, args?: unknown): Promise<T> {
    return this.request<T>(cmd, args);
  }

  request<T>(cmd: string, args?: unknown, signal?: AbortSignal): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Browser viewer is closed'));
    if (
      ![
        'initialize',
        'describe_source',
        'load_file',
        'load_surface',
        'load_surface_scalar',
        'load_surface_labels',
        'unload_volume',
        'set_timepoint',
        'projection_frame',
        'label_at_world',
        'render_view',
        'diagnostics',
      ].includes(cmd)
    ) {
      return Promise.reject(new UnsupportedBrowserCapability(cmd));
    }
    if (signal?.aborted)
      return Promise.reject(new DOMException('Operation cancelled', 'AbortError'));
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(id);
        clean();
        this.worker.postMessage({ cancel: id } satisfies WorkerRequest);
        reject(new DOMException('Operation cancelled', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        clean();
        this.worker.postMessage({ cancel: id } satisfies WorkerRequest);
        reject(
          new Error(
            'Browser operation timed out. Close and reopen the viewer if the device is unavailable.',
          ),
        );
      }, 60_000);
      const clean = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      };
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, clean });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        this.worker.postMessage({ id, cmd, args } satisfies WorkerRequest);
      } catch (e) {
        this.pending.delete(id);
        clean();
        reject(e);
      }
    });
  }

  private shutdown(error: Error) {
    if (this.disposed) return;
    this.fail(error);
    this.dispose();
    this.onFailure?.(error);
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      p.clean();
      p.reject(error);
    }
    this.pending.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new DOMException('Viewer closed', 'AbortError'));
    // Termination also retires the worker's WASM heap and browser GPU objects.
    this.worker.terminate();
  }
}
