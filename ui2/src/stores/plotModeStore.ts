/**
 * plotModeStore — singleton coordinating plot-mode selection across all
 * React roots (Inspector "Open in Plot" buttons, the integrated workspace's
 * bottom Plot pane, the standalone PlotPanel side-tab, etc.).
 *
 * The store carries two coupled fields:
 *   - `activePlotModeId` — the id of the requested plot mode, or `null` when
 *     nothing has been requested yet.
 *   - `selectionSource` — `'auto'` while the active mode was chosen by the
 *     context-aware resolver (e.g. 4D layer → time series), or `'user'` once
 *     the user has manually picked a mode (tab click, Inspector "Open in
 *     Plot"). The source MUST stick across active-layer changes; only
 *     transient `supports()` fallbacks are exempt and they DO NOT flip the
 *     source back to `auto`.
 *
 * Two setters distinguish intent:
 *   - `setActivePlotMode(id)` — user intent. Always sets `selectionSource =
 *     'user'`. Wired to PlotHost's tab-click callback and Inspector "Open in
 *     Plot" affordances.
 *   - `setAutoActivePlotMode(id)` — auto resolver. Only writes when the
 *     current source is `'auto'`; otherwise it is a no-op so user picks are
 *     never overwritten by an active-layer change.
 *
 * The full policy lives in `usePlotModeSelection` (mote
 * `bd-01KQK24YYRXCDJKAPE6SBB84JE`); this store is the persistent backbone
 * the policy hook reads and writes.
 *
 * Persistence (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`):
 * `activePlotModeId` and `selectionSource` round-trip through localStorage
 * so a refresh keeps the user's last manual pick. The pure setter logic
 * remains policy-free.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Origin of the active mode selection. */
export type PlotModeSelectionSource = 'auto' | 'user';

export interface PlotModeStore {
  /** Currently requested plot-host mode, or `null` when no mode has been resolved yet. */
  activePlotModeId: string | null;
  /** Whether the active mode came from the auto resolver or a manual user pick. */
  selectionSource: PlotModeSelectionSource;
  /** User intent: tab click or Inspector "Open in Plot". Always sets source to `'user'`. */
  setActivePlotMode: (id: string | null) => void;
  /** Auto resolver: no-op when current source is `'user'`. Sets source to `'auto'` otherwise. */
  setAutoActivePlotMode: (id: string | null) => void;
  /** Test helper — restores the initial `{ null, 'auto' }` state. */
  resetPlotModeStore: () => void;
}

declare global {
  interface Window {
    __plotModeStore?: ReturnType<typeof createPlotModeStore>;
  }
}

const PLOT_MODE_PERSIST_VERSION = 1;
const PLOT_MODE_PERSIST_NAME = 'brainflow2-plot-mode';

const createPlotModeStore = () =>
  create<PlotModeStore>()(
    persist(
      (set) => ({
        activePlotModeId: null,
        selectionSource: 'auto',
        setActivePlotMode: (id) => {
          set((state) => {
            if (state.activePlotModeId === id && state.selectionSource === 'user') {
              return state;
            }
            return { activePlotModeId: id, selectionSource: 'user' };
          });
        },
        setAutoActivePlotMode: (id) => {
          set((state) => {
            if (state.selectionSource === 'user') return state;
            if (state.activePlotModeId === id && state.selectionSource === 'auto') {
              return state;
            }
            return { activePlotModeId: id, selectionSource: 'auto' };
          });
        },
        resetPlotModeStore: () => {
          set({ activePlotModeId: null, selectionSource: 'auto' });
        },
      }),
      {
        name: PLOT_MODE_PERSIST_NAME,
        version: PLOT_MODE_PERSIST_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          activePlotModeId: state.activePlotModeId,
          selectionSource: state.selectionSource,
        }),
      },
    ),
  );

// Cross-React-root sharing — Golden Layout panels each have their own React
// root, so the store must be a process-wide singleton (same pattern as
// `useLayerStore`).
export const usePlotModeStore: ReturnType<typeof createPlotModeStore> = (() => {
  if (typeof window !== 'undefined' && window.__plotModeStore) {
    return window.__plotModeStore;
  }
  const store = createPlotModeStore();
  if (typeof window !== 'undefined') {
    window.__plotModeStore = store;
  }
  return store;
})();
