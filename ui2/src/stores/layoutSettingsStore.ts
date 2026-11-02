/**
 * layoutSettingsStore — process-wide singleton for persisted UI-layout
 * preferences. Scope (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`):
 *
 *   - `bottomDockSizes` — `[plot, activity, log]` pixel sizes that the
 *     `BottomWorkbenchDock` last reported via `onSizesChange`.
 *   - `bottomDockLogCollapsed` — last log-collapse affordance state.
 *   - `bottomDockPlotMaximized` — last plot-maximize affordance state.
 *   - `bottomDockOpenByKey` — whether the center-workspace bottom dock
 *     (`BottomWorkbenchDock` — Activity | Plot | Log — mounted via
 *     `CenterWithBottomDock` for every imaging mode and tool) is shown, per
 *     tool (`DockHeightKey`, the same key as its height; QA 2026-10-31 N24).
 *     A missing key uses `DOCK_OPEN_DEFAULTS` (shown); the `p` key / dock
 *     close button hides it for the front tab's tool only. v4 moved the
 *     single `bottomDockOpen` into the imaging key.
 *   - `bottomDockHeights` — last dragged height (px) of that dock pane, per
 *     tool (`DockHeightKey`: imaging views, Set studio, BIDS, Analysis),
 *     restored on the next open. v3 moved the single `bottomDockHeight` into
 *     the imaging key.
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

import {
  DOCK_OPEN_DEFAULTS,
  type DockHeightKey,
  type DockSizes,
  type DockTabId,
} from '@/components/layout/bottomWorkbenchDock.constants';
import type { WorkspaceType } from '@/types/workspace';

const LAYOUT_SETTINGS_PERSIST_NAME = 'brainflow2-layout-settings';
// v2: the plot-only dock (`plotDock*`) became the shell-wide Activity|Plot|Log
// dock (`bottomDock*`), open by default in all imaging modes.
// v3: `bottomDockHeight` became `bottomDockHeights`, keyed by tool (N13).
// v4: `bottomDockOpen` became `bottomDockOpenByKey`, keyed the same way (N24).
const LAYOUT_SETTINGS_PERSIST_VERSION = 4;

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
  if (version < 3) {
    // The one height was the imaging views' (Studio did not have its own).
    const single = state.bottomDockHeight;
    state.bottomDockHeights = typeof single === 'number' ? { imaging: single } : {};
    delete state.bottomDockHeight;
  }
  if (version < 4) {
    // The one flag was shared by every tab; the imaging views keep it.
    const single = state.bottomDockOpen;
    state.bottomDockOpenByKey = typeof single === 'boolean' ? { imaging: single } : {};
    delete state.bottomDockOpen;
  }
  return state;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The persisted settings with the per-tool dock maps made safe: a map that is
 * missing, null or not an object becomes `{}`, and entries of the wrong type
 * are dropped (the defaults then apply).
 */
export function sanitizeLayoutSettings(persisted: unknown): Partial<LayoutSettingsStore> {
  if (!isPlainObject(persisted)) return {};
  const state: Record<string, unknown> = { ...persisted };
  const keep = <T>(value: unknown, ok: (v: unknown) => v is T): Record<string, T> =>
    isPlainObject(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => ok(entry[1])))
      : {};
  state.bottomDockOpenByKey = keep(state.bottomDockOpenByKey, (v): v is boolean => typeof v === 'boolean');
  state.bottomDockHeights = keep(
    state.bottomDockHeights,
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return state as Partial<LayoutSettingsStore>;
}

/**
 * The dock key of the front tab, for the dock calls that name no tool (the
 * `p` key, View › Panels, "Open in dock"). `workspaceStore` registers it, so
 * this store does not import the workspace store; until then, `imaging`.
 */
let activeDockKeyResolver: () => DockHeightKey = () => 'imaging';

export function setActiveDockKeyResolver(resolver: () => DockHeightKey): void {
  activeDockKeyResolver = resolver;
}

/** The dock key of the front tab (see {@link setActiveDockKeyResolver}). */
export function activeDockKey(): DockHeightKey {
  return activeDockKeyResolver();
}

/** Whether `key`'s dock is shown, in `state` (a selector for `useLayoutSettingsStore`). */
export function bottomDockOpenFor(
  state: Pick<LayoutSettingsStore, 'bottomDockOpenByKey'>,
  key: DockHeightKey,
): boolean {
  return state.bottomDockOpenByKey[key] ?? DOCK_OPEN_DEFAULTS[key];
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
  /** Whether each tool's bottom dock is shown; a missing key uses DOCK_OPEN_DEFAULTS. */
  bottomDockOpenByKey: Partial<Record<DockHeightKey, boolean>>;
  /** Whether the (open) bottom dock is collapsed to just its tab bar. */
  bottomDockMinimized: boolean;
  /** Last dragged dock height per tool; a missing key uses DOCK_HEIGHT_DEFAULTS. */
  bottomDockHeights: Partial<Record<DockHeightKey, number>>;
  /** Arrangement of the three orthogonal slices (flexible ortho + integrated). */
  orthoArrangement: OrthoArrangement;
  /** Orientation of the Integrated volume/surface split. */
  integratedSplit: IntegratedSplit;
  goldenLayoutState: GoldenLayoutSavedState | null;
  integratedDefaultDisplayMode: WorkspaceType | null;
  /**
   * First screen (qa-features-2026-10-31 §7): with nothing loaded at launch
   * (a cold start, or restored tabs, whose layers never come back; N21), the
   * front view opens on the MNI T1 with a "Drop a map here" hint. On by
   * default; Settings › Start turns it off.
   */
  firstScreenTemplate: boolean;

  setBottomDockSizes: (sizes: DockSizes) => void;
  setBottomDockLogCollapsed: (collapsed: boolean) => void;
  setBottomDockPlotMaximized: (maximized: boolean) => void;
  setBottomDockActiveTab: (tab: DockTabId) => void;
  /** Show or hide `key`'s dock (default: the front tab's tool). */
  setBottomDockOpen: (open: boolean, key?: DockHeightKey) => void;
  setBottomDockMinimized: (minimized: boolean) => void;
  /** Toggle `key`'s dock (default: the front tab's tool). */
  toggleBottomDock: (key?: DockHeightKey) => void;
  /** Whether `key`'s dock is shown (default: the front tab's tool). */
  isBottomDockOpen: (key?: DockHeightKey) => boolean;
  /** Remember the dock height for `key` (default: the imaging views). */
  setBottomDockHeight: (height: number, key?: DockHeightKey) => void;
  setOrthoArrangement: (arrangement: OrthoArrangement) => void;
  setIntegratedSplit: (split: IntegratedSplit) => void;
  setGoldenLayoutState: (state: GoldenLayoutSavedState | null) => void;
  setIntegratedDefaultDisplayMode: (mode: WorkspaceType | null) => void;
  setFirstScreenTemplate: (enabled: boolean) => void;

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
  bottomDockOpenByKey: {},
  bottomDockMinimized: false,
  bottomDockHeights: {},
  orthoArrangement: 'grid',
  integratedSplit: 'horizontal',
  goldenLayoutState: null,
  integratedDefaultDisplayMode: null,
  firstScreenTemplate: true,
} as const;

const createLayoutSettingsStore = () =>
  create<LayoutSettingsStore>()(
    persist(
      (set, get) => ({
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
        setBottomDockOpen: (open, key = activeDockKey()) => {
          set((state) =>
            bottomDockOpenFor(state, key) === open
              ? state
              : { bottomDockOpenByKey: { ...state.bottomDockOpenByKey, [key]: open } },
          );
        },
        setBottomDockMinimized: (minimized) => {
          set((state) =>
            state.bottomDockMinimized === minimized ? state : { bottomDockMinimized: minimized },
          );
        },
        toggleBottomDock: (key = activeDockKey()) => {
          set((state) => ({
            bottomDockOpenByKey: { ...state.bottomDockOpenByKey, [key]: !bottomDockOpenFor(state, key) },
          }));
        },
        isBottomDockOpen: (key = activeDockKey()) => bottomDockOpenFor(get(), key),
        setBottomDockHeight: (height, key = 'imaging') => {
          set((state) => {
            const next = Math.round(height);
            return state.bottomDockHeights[key] === next
              ? state
              : { bottomDockHeights: { ...state.bottomDockHeights, [key]: next } };
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
        setFirstScreenTemplate: (enabled) => {
          set((state) =>
            state.firstScreenTemplate === enabled ? state : { firstScreenTemplate: enabled },
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
        // A hand-edited or corrupt payload must not leave the per-tool maps
        // null (every dock read would throw).
        merge: (persisted, current) => ({
          ...current,
          ...sanitizeLayoutSettings(persisted),
        }),
        partialize: (state) => ({
          bottomDockSizes: state.bottomDockSizes,
          bottomDockLogCollapsed: state.bottomDockLogCollapsed,
          bottomDockPlotMaximized: state.bottomDockPlotMaximized,
          bottomDockActiveTab: state.bottomDockActiveTab,
          bottomDockOpenByKey: state.bottomDockOpenByKey,
          bottomDockMinimized: state.bottomDockMinimized,
          bottomDockHeights: state.bottomDockHeights,
          orthoArrangement: state.orthoArrangement,
          integratedSplit: state.integratedSplit,
          goldenLayoutState: state.goldenLayoutState,
          integratedDefaultDisplayMode: state.integratedDefaultDisplayMode,
          firstScreenTemplate: state.firstScreenTemplate,
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
