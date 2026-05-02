/**
 * logStore — bounded ring buffer of structured log entries surfaced in the
 * bottom dock's `Log` slot.
 *
 * The store is presentation-agnostic; an EventBus subscriber (see
 * `LogService.bootstrapLogService()`) translates interesting bus events
 * into entries here. Other surfaces may also call `addLogEntry()`
 * directly for explicit user-visible events (e.g. an export starting,
 * an annotation save failing).
 *
 * Design contract (mockup-7 §11.2 / Design.md):
 *   - Log is the chronological event stream — ordered, oldest first.
 *   - Levels: `info`, `warn`, `error`. Activity is owned by the
 *     Activity panel; Log records what happened, not what's running.
 *   - Bounded buffer keeps memory predictable; oldest entries drop off.
 */

import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Monotonically increasing ID assigned at insertion time. */
  readonly id: number;
  /** Wall-clock timestamp (ms since epoch). */
  readonly timestamp: number;
  readonly level: LogLevel;
  /** Short symbolic source label (e.g. `'volume'`, `'surface'`, `'atlas'`). */
  readonly source: string;
  readonly message: string;
}

const DEFAULT_MAX_ENTRIES = 500;

export interface LogState {
  entries: LogEntry[];
  maxEntries: number;
  /** Append a new entry. Trims to `maxEntries`. Returns the new entry id. */
  addEntry: (entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: number }) => number;
  clear: () => void;
}

declare global {
  interface Window {
    __logStore?: ReturnType<typeof createLogStore>;
  }
}

let nextId = 1;

const createLogStore = () =>
  create<LogState>((set, get) => ({
    entries: [],
    maxEntries: DEFAULT_MAX_ENTRIES,
    addEntry: (entry) => {
      const id = nextId++;
      const stamped: LogEntry = {
        id,
        timestamp: entry.timestamp ?? Date.now(),
        level: entry.level,
        source: entry.source,
        message: entry.message,
      };
      set((state) => {
        const next = state.entries.length >= state.maxEntries
          ? [...state.entries.slice(state.entries.length - state.maxEntries + 1), stamped]
          : [...state.entries, stamped];
        return { entries: next };
      });
      return id;
      // `get` parked here for future "drop above level" queries.
      void get;
    },
    clear: () => {
      set({ entries: [] });
    },
  }));

export const useLogStore: ReturnType<typeof createLogStore> = (() => {
  if (typeof window !== 'undefined' && window.__logStore) {
    return window.__logStore;
  }
  const store = createLogStore();
  if (typeof window !== 'undefined') {
    window.__logStore = store;
  }
  return store;
})();

/** Convenience emitter — equivalent to calling `useLogStore.getState().addEntry(...)`. */
export function addLogEntry(entry: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: number }): number {
  return useLogStore.getState().addEntry(entry);
}
