/**
 * layoutSettingsStore — process-wide singleton for persisted UI-layout
 * preferences. Scope (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`):
 *
 *   - `bottomDockSizes` — `[plot, activity, log]` pixel sizes that the
 *     `BottomWorkbenchDock` last reported via `onSizesChange`.
 *   - `bottomDockLogCollapsed` — last log-collapse affordance state.
 *   - `bottomDockPlotMaximized` — last plot-maximize affordance state.
 *   - `bottomDockOpen` — whether the shared center-workspace bottom dock
 *     (`BottomWorkbenchDock` — Activity | Plot | Log — mounted via
 *     `CenterWithBottomDock` for every imaging mode) is shown. Defaults open
 *     so the analysis panels are available in all modes, not just Integrated;
 *     the `p` key / dock close button hides it.
 *   - `bottomDockHeight` — last dragged height (px) of that dock pane, restored
 *     on the next open.
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

import type { DockSizes, DockTabId } from '@/components/layout/bottomWorkbenchDock.constants';
import type { WorkspaceType } from '@/types/workspace';

const LAYOUT_SETTINGS_PERSIST_NAME = 'brainflow2-layout-settings';
// v2: the plot-only dock (`plotDock*`) became the shell-wide Activity|Plot|Log
// dock (`bottomDock*`), open by default in all imaging modes.
const LAYOUT_SETTINGS_PERSIST_VERSION = 2;

/**
 * Migrate persisted layout settings to the current version. v1 stored
 * `plotDockOpen` / `plotDockHeight` for the opt-in plot dock. v2 renames these
 * to `bottomDockOpen` / `bottomDockHeight`: the saved height is carried over,
 * but the open flag intentionally resets to the new default (open everywhere),
 * since the dock's meaning changed from "opt-in plot pane" to "shell dock".
 */
export function migrateLayoutSettings(
  persisted: unknown,
  version: number,
): Record<string, unknown> {
  const state = (
    persisted && typeof persisted === 'object' ? { ...(persisted as Record<string, unknown>) } : {}
  ) as Record<string, unknown>;
  if (version < 2) {
    if (state.bottomDockHeight == null && typeof state.plotDockHeight === 'number') {
      state.bottomDockHeight = state.plotDockHeight;
    }
    delete state.plotDockOpen;
    delete state.plotDockHeight;
  }
  return state;
}

/**
 * Loose type for the GoldenLayout state — we treat it as opaque JSON so we
 * don't have to depend on the GL types in stores. Validation happens at the
 * `GoldenLayoutRoot` boundary on restore.
 */
export type GoldenLayoutSavedState = Record<string, unknown>;

/**
 * Arrangement of the three orthogonal slices (axial/sagittal/coronal) in the
 * flexible orthogonal workspace:
 *   - `grid`   — axial on top spanning full width, sagittal | coronal below.
 *   - `row`    — a horizontal row of three.
 *   - `column` — a vertical column of three.
 */
export type OrthoArrangement = 'grid' | 'row' | 'column';

/**
 * Orientation of the Integrated workspace's volume/surface split:
 *   - `horizontal` — volumes | surface side-by-side.
 *   - `vertical`   — volumes on top, surface below.
 */
export type IntegratedSplit = 'horizontal' | 'vertical';

export interface LayoutSettingsStore {
  bottomDockSizes: DockSizes | null;
  bottomDockLogCollapsed: boolean;
  bottomDockPlotMaximized: boolean;
  /** Active tab of the tabbed bottom dock (`Activity | Plot | Log`). */
  bottomDockActiveTab: DockTabId | null;
  /** Whether the shell bottom dock is shown (default open in all imaging modes). */
  bottomDockOpen: boolean;
  /** Whether the (open) bottom dock is collapsed to just its tab bar. */
  bottomDockMinimized: boolean;
  bottomDockHeight: number | null;
  /** Arrangement of the three orthogonal slices (flexible ortho + integrated). */
  orthoArrangement: OrthoArrangement;
  /** Orientation of the Integrated volume/surface split. */
  integratedSplit: IntegratedSplit;
  goldenLayoutState: GoldenLayoutSavedState | null;
  integratedDefaultDisplayMode: WorkspaceType | null;

  setBottomDockSizes: (sizes: DockSizes) => void;
  setBottomDockLogCollapsed: (collapsed: boolean) => void;
  setBottomDockPlotMaximized: (maximized: boolean) => void;
  setBottomDockActiveTab: (tab: DockTabId) => void;
  setBottomDockOpen: (open: boolean) => void;
  setBottomDockMinimized: (minimized: boolean) => void;
  toggleBottomDock: () => void;
  setBottomDockHeight: (height: number) => void;
  setOrthoArrangement: (arrangement: OrthoArrangement) => void;
  setIntegratedSplit: (split: IntegratedSplit) => void;
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
  bottomDockActiveTab: null,
  bottomDockOpen: true,
  bottomDockMinimized: false,
  bottomDockHeight: null,
  orthoArrangement: 'grid',
  integratedSplit: 'horizontal',
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
            if (prev && prev[0] === sizes[0] && prev[1] === sizes[1] && prev[2] === sizes[2]) {
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
        setBottomDockActiveTab: (tab) => {
          set((state) =>
            state.bottomDockActiveTab === tab ? state : { bottomDockActiveTab: tab },
          );
        },
        setBottomDockOpen: (open) => {
          set((state) => (state.bottomDockOpen === open ? state : { bottomDockOpen: open }));
        },
        setBottomDockMinimized: (minimized) => {
          set((state) =>
            state.bottomDockMinimized === minimized ? state : { bottomDockMinimized: minimized },
          );
        },
        toggleBottomDock: () => {
          set((state) => ({ bottomDockOpen: !state.bottomDockOpen }));
        },
        setBottomDockHeight: (height) => {
          set((state) => {
            const next = Math.round(height);
            return state.bottomDockHeight === next ? state : { bottomDockHeight: next };
          });
        },
        setOrthoArrangement: (arrangement) => {
          set((state) =>
            state.orthoArrangement === arrangement ? state : { orthoArrangement: arrangement },
          );
        },
        setIntegratedSplit: (split) => {
          set((state) => (state.integratedSplit === split ? state : { integratedSplit: split }));
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
        migrate: (persisted, version) =>
          migrateLayoutSettings(persisted, version) as unknown as LayoutSettingsStore,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          bottomDockSizes: state.bottomDockSizes,
          bottomDockLogCollapsed: state.bottomDockLogCollapsed,
          bottomDockPlotMaximized: state.bottomDockPlotMaximized,
          bottomDockActiveTab: state.bottomDockActiveTab,
          bottomDockOpen: state.bottomDockOpen,
          bottomDockMinimized: state.bottomDockMinimized,
          bottomDockHeight: state.bottomDockHeight,
          orthoArrangement: state.orthoArrangement,
          integratedSplit: state.integratedSplit,
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
