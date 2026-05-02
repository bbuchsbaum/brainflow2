/**
 * layoutSettingsStore — process-wide singleton for persisted UI-layout
 * preferences. Scope (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`):
 *
 *   - `bottomDockSizes` — `[plot, activity, log]` pixel sizes that the
 *     `BottomWorkbenchDock` last reported via `onSizesChange`.
 *   - `bottomDockLogCollapsed` — last log-collapse affordance state.
 *   - `bottomDockPlotMaximized` — last plot-maximize affordance state.
 *   - `goldenLayoutState` — serialized GoldenLayout root config from
 *     `goldenLayout.saveLayout()`. Restored on subsequent mounts so column
 *     widths, side-panel tab order/active-tab, and the side-panel structure
 *     all survive a refresh.
 *   - `integratedDefaultDisplayMode` — last `WorkspaceType` the user picked
 *     from the integrated-mode selector. Lets a returning session reopen
 *     into the same display mode they left in.
 *
 * The store is intentionally separate from `workspaceStore`: workspaces are
 * application content (tabs the user creates / closes); these are pure UX
 * preferences. Mixing the two made the legacy startup wipe necessary in the
 * first place — keeping them separate keeps the migration story simple.
 *
 * Cross-root sharing: Golden Layout panels have isolated React roots, so
 * the store is exposed via `window.__layoutSettingsStore` like the other
 * shared singletons (`useLogStore`, `usePlotModeStore`, `useLayerStore`).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import type { DockSizes } from '@/components/layout/bottomWorkbenchDock.constants';
import type { WorkspaceType } from '@/types/workspace';

const LAYOUT_SETTINGS_PERSIST_NAME = 'brainflow2-layout-settings';
const LAYOUT_SETTINGS_PERSIST_VERSION = 1;

/**
 * Loose type for the GoldenLayout state — we treat it as opaque JSON so we
 * don't have to depend on the GL types in stores. Validation happens at the
 * `GoldenLayoutRoot` boundary on restore.
 */
export type GoldenLayoutSavedState = Record<string, unknown>;

export interface LayoutSettingsStore {
  bottomDockSizes: DockSizes | null;
  bottomDockLogCollapsed: boolean;
  bottomDockPlotMaximized: boolean;
  goldenLayoutState: GoldenLayoutSavedState | null;
  integratedDefaultDisplayMode: WorkspaceType | null;

  setBottomDockSizes: (sizes: DockSizes) => void;
  setBottomDockLogCollapsed: (collapsed: boolean) => void;
  setBottomDockPlotMaximized: (maximized: boolean) => void;
  setGoldenLayoutState: (state: GoldenLayoutSavedState | null) => void;
  setIntegratedDefaultDisplayMode: (mode: WorkspaceType | null) => void;

  /** Test helper — restores the initial defaults. */
  resetLayoutSettings: () => void;
}

declare global {
  interface Window {
    __layoutSettingsStore?: ReturnType<typeof createLayoutSettingsStore>;
  }
}

const INITIAL_STATE = {
  bottomDockSizes: null,
  bottomDockLogCollapsed: false,
  bottomDockPlotMaximized: false,
  goldenLayoutState: null,
  integratedDefaultDisplayMode: null,
} as const;

const createLayoutSettingsStore = () =>
  create<LayoutSettingsStore>()(
    persist(
      (set) => ({
        ...INITIAL_STATE,
        setBottomDockSizes: (sizes) => {
          set((state) => {
            const prev = state.bottomDockSizes;
            if (
              prev &&
              prev[0] === sizes[0] &&
              prev[1] === sizes[1] &&
              prev[2] === sizes[2]
            ) {
              return state;
            }
            return { bottomDockSizes: sizes };
          });
        },
        setBottomDockLogCollapsed: (collapsed) => {
          set((state) =>
            state.bottomDockLogCollapsed === collapsed
              ? state
              : { bottomDockLogCollapsed: collapsed },
          );
        },
        setBottomDockPlotMaximized: (maximized) => {
          set((state) =>
            state.bottomDockPlotMaximized === maximized
              ? state
              : { bottomDockPlotMaximized: maximized },
          );
        },
        setGoldenLayoutState: (next) => {
          set({ goldenLayoutState: next });
        },
        setIntegratedDefaultDisplayMode: (mode) => {
          set((state) =>
            state.integratedDefaultDisplayMode === mode
              ? state
              : { integratedDefaultDisplayMode: mode },
          );
        },
        resetLayoutSettings: () => {
          set({ ...INITIAL_STATE });
        },
      }),
      {
        name: LAYOUT_SETTINGS_PERSIST_NAME,
        version: LAYOUT_SETTINGS_PERSIST_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          bottomDockSizes: state.bottomDockSizes,
          bottomDockLogCollapsed: state.bottomDockLogCollapsed,
          bottomDockPlotMaximized: state.bottomDockPlotMaximized,
          goldenLayoutState: state.goldenLayoutState,
          integratedDefaultDisplayMode: state.integratedDefaultDisplayMode,
        }),
      },
    ),
  );

export const useLayoutSettingsStore: ReturnType<typeof createLayoutSettingsStore> = (() => {
  if (typeof window !== 'undefined' && window.__layoutSettingsStore) {
    return window.__layoutSettingsStore;
  }
  const store = createLayoutSettingsStore();
  if (typeof window !== 'undefined') {
    window.__layoutSettingsStore = store;
  }
  return store;
})();
