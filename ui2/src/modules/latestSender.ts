/**
 * Send full-state updates one at a time, latest wins: while a send is in
 * flight, newer values replace each other and only the last is sent next.
 * A result is delivered only when no newer value is queued, so a slow,
 * superseded response never overwrites a newer one (AGENTS.md, async
 * ownership). After `dispose()` nothing is sent or delivered.
 */
export interface LatestSender<T> {
  push(value: T): void;
  /** Resolves when nothing is queued or in flight (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export function createLatestSender<T, R>(
  send: (value: T) => Promise<R>,
  handlers: {
    onResult(value: T, result: R): void;
    onError(value: T, error: unknown): void;
  },
): LatestSender<T> {
  let pending: { value: T } | null = null;
  let active = false;
  let running: Promise<void> = Promise.resolve();
  let disposed = false;

  const pump = async () => {
    active = true;
    try {
      while (pending && !disposed) {
        const { value } = pending;
        pending = null;
        try {
          const result = await send(value);
          if (!disposed && !pending) handlers.onResult(value, result);
        } catch (error) {
          if (!disposed && !pending) handlers.onError(value, error);
        }
      }
    } finally {
      active = false;
    }
  };

  return {
    push(value) {
      if (disposed) return;
      pending = { value };
      if (!active) running = pump();
    },
    idle: () => running,
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
