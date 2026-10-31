import { create } from 'zustand';
import type { LayoutConfig } from 'golden-layout';
import { getLayoutService } from '@/services/layoutService';
import { currentTabTakesLayout, setCurrentTabLayout } from '@/services/workspaceNavigation';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { addLogEntry } from '@/stores/logStore';
import { DOCK_TABS, type DockTabId } from '@/components/layout/bottomWorkbenchDock.constants';
import { isViewWorkspaceType } from '@/components/ui/displayModeSelector.helpers';
import type { WorkspaceType } from '@/types/workspace';
import { cloneLayoutConfig } from '@/utils/layoutConfigUtils';

const STORAGE_KEY = 'brainflow2-layout-library';
const LAYOUT_LIBRARY_SCHEMA_VERSION = 1;

/**
 * What a saved layout restores besides the panel arrangement: the layout of
 * the tab in front (applied to the current tab, like a pill) and the bottom
 * dock. Without it, restoring "qa-run3" after switching to Mosaic and the Plot
 * tab looked like nothing happened (QA 2026-10-30 F2).
 */
export interface SavedViewState {
  /** The front view tab's layout when saved; null when a tool was in front. */
  workspaceType: WorkspaceType | null;
  dock: {
    open: boolean;
    minimized: boolean;
    activeTab: DockTabId | null;
    height: number | null;
  };
}

export interface NamedLayout {
  id: string;
  name: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  layoutConfig: LayoutConfig;
  /** Absent in layouts saved before 2026-10-30. */
  view?: SavedViewState;
}

interface LayoutLibraryPayload {
  schemaVersion: number;
  activeLayoutId: string | null;
  layouts: NamedLayout[];
}

interface LayoutLibraryStore {
  layouts: NamedLayout[];
  activeLayoutId: string | null;
  lastError: string | null;
  saveCurrentLayout: (name: string) => boolean;
  loadLayout: (layoutId: string) => boolean;
  renameLayout: (layoutId: string, name: string) => boolean;
  deleteLayout: (layoutId: string) => boolean;
  clearError: () => void;
}

function makeDefaultPayload(): LayoutLibraryPayload {
  return {
    schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
    activeLayoutId: null,
    layouts: [],
  };
}

function isLayoutConfig(value: unknown): value is LayoutConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeRoot = (value as { root?: unknown }).root;
  return Boolean(maybeRoot && typeof maybeRoot === 'object');
}

const DOCK_TAB_IDS: ReadonlySet<string> = new Set(DOCK_TABS.map((tab) => tab.id));

function parseViewState(value: unknown): SavedViewState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { workspaceType?: unknown; dock?: Record<string, unknown> };
  const workspaceType =
    typeof raw.workspaceType === 'string' && isViewWorkspaceType(raw.workspaceType as WorkspaceType)
      ? (raw.workspaceType as WorkspaceType)
      : null;
  const dock = raw.dock && typeof raw.dock === 'object' ? raw.dock : {};
  return {
    workspaceType,
    dock: {
      open: dock.open !== false,
      minimized: dock.minimized === true,
      activeTab:
        typeof dock.activeTab === 'string' && DOCK_TAB_IDS.has(dock.activeTab)
          ? (dock.activeTab as DockTabId)
          : null,
      height: typeof dock.height === 'number' && Number.isFinite(dock.height) ? dock.height : null,
    },
  };
}

function captureViewState(): SavedViewState {
  const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
  const active = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : undefined;
  const settings = useLayoutSettingsStore.getState();
  return {
    workspaceType: active && currentTabTakesLayout() ? active.type : null,
    dock: {
      open: settings.bottomDockOpen,
      minimized: settings.bottomDockMinimized,
      activeTab: settings.bottomDockActiveTab,
      height: settings.bottomDockHeights.imaging ?? null,
    },
  };
}

function applyViewState(view: SavedViewState): void {
  // Like a pill: the current tab takes the layout; a tool in front keeps its own.
  if (view.workspaceType && currentTabTakesLayout()) {
    setCurrentTabLayout(view.workspaceType);
  }
  const settings = useLayoutSettingsStore.getState();
  settings.setBottomDockOpen(view.dock.open);
  settings.setBottomDockMinimized(view.dock.minimized);
  if (view.dock.activeTab) settings.setBottomDockActiveTab(view.dock.activeTab);
  if (view.dock.height !== null) settings.setBottomDockHeight(view.dock.height);
}

function parsePayload(raw: string | null): LayoutLibraryPayload {
  if (!raw) {
    return makeDefaultPayload();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LayoutLibraryPayload>;
    if (parsed.schemaVersion !== LAYOUT_LIBRARY_SCHEMA_VERSION) {
      console.warn('[layoutLibraryStore] Ignoring saved layouts due to schema mismatch');
      return makeDefaultPayload();
    }

    if (!Array.isArray(parsed.layouts)) {
      console.warn('[layoutLibraryStore] Invalid layout payload; resetting');
      return makeDefaultPayload();
    }

    const layouts: NamedLayout[] = parsed.layouts
      .filter((entry): entry is NamedLayout => {
        return Boolean(
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.name === 'string' &&
          typeof entry.createdAt === 'number' &&
          typeof entry.updatedAt === 'number' &&
          entry.schemaVersion === LAYOUT_LIBRARY_SCHEMA_VERSION &&
          isLayoutConfig(entry.layoutConfig)
        );
      })
      .map((entry) => {
        const layout: NamedLayout = {
          ...entry,
          layoutConfig: cloneLayoutConfig(entry.layoutConfig),
        };
        const view = parseViewState(entry.view);
        if (view) layout.view = view;
        else delete layout.view;
        return layout;
      });

    return {
      schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
      activeLayoutId:
        typeof parsed.activeLayoutId === 'string' && layouts.some((layout) => layout.id === parsed.activeLayoutId)
          ? parsed.activeLayoutId
          : null,
      layouts,
    };
  } catch (error) {
    console.warn('[layoutLibraryStore] Failed to parse saved layouts; resetting', error);
    return makeDefaultPayload();
  }
}

function persistPayload(payload: LayoutLibraryPayload): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: payload.schemaVersion,
        activeLayoutId: payload.activeLayoutId,
        layouts: payload.layouts,
      })
    );
  } catch (error) {
    console.error('[layoutLibraryStore] Failed to persist layouts:', error);
  }
}

const initialPayload = parsePayload(typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null);

export const useLayoutLibraryStore = create<LayoutLibraryStore>((set, get) => ({
  layouts: initialPayload.layouts,
  activeLayoutId: initialPayload.activeLayoutId,
  lastError: null,

  saveCurrentLayout: (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      set({ lastError: 'Layout name cannot be empty.' });
      return false;
    }

    const layoutConfig = getLayoutService().captureLayout();
    if (!layoutConfig) {
      set({ lastError: 'Layout is not ready yet. Try again once the workspace is visible.' });
      return false;
    }

    const view = captureViewState();
    const now = Date.now();
    const existing = get().layouts.find(
      (layout) => layout.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()
    );

    let nextLayouts: NamedLayout[];
    let activeLayoutId: string;

    if (existing) {
      nextLayouts = get().layouts.map((layout) =>
        layout.id === existing.id
          ? {
              ...layout,
              name: trimmed,
              updatedAt: now,
              layoutConfig: cloneLayoutConfig(layoutConfig),
              view,
            }
          : layout
      );
      activeLayoutId = existing.id;
    } else {
      const newLayout: NamedLayout = {
        id: `layout-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        layoutConfig: cloneLayoutConfig(layoutConfig),
        view,
      };
      nextLayouts = [...get().layouts, newLayout];
      activeLayoutId = newLayout.id;
    }

    const payload: LayoutLibraryPayload = {
      schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
      layouts: nextLayouts,
      activeLayoutId,
    };

    persistPayload(payload);
    set({ layouts: nextLayouts, activeLayoutId, lastError: null });
    return true;
  },

  loadLayout: (layoutId) => {
    const layout = get().layouts.find((entry) => entry.id === layoutId);
    if (!layout) {
      set({ lastError: 'Layout not found.' });
      return false;
    }

    // applyLayout falls back to the default shell itself ('reset'); the
    // message says which of the two is on screen.
    const result = getLayoutService().applyLayout(layout.layoutConfig);
    if (result !== 'applied') {
      const message =
        result === 'reset'
          ? `Layout '${layout.name}' could not be restored, so the panels were reset to the default arrangement.`
          : `Layout '${layout.name}' could not be restored.`;
      addLogEntry({ level: 'error', source: 'layout', message });
      set({ lastError: message });
      return false;
    }
    if (layout.view) applyViewState(layout.view);

    const payload: LayoutLibraryPayload = {
      schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
      layouts: get().layouts,
      activeLayoutId: layoutId,
    };

    persistPayload(payload);
    set({ activeLayoutId: layoutId, lastError: null });
    return true;
  },

  renameLayout: (layoutId, name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      set({ lastError: 'Layout name cannot be empty.' });
      return false;
    }

    const now = Date.now();
    const exists = get().layouts.some(
      (layout) => layout.id !== layoutId && layout.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()
    );
    if (exists) {
      set({ lastError: `A layout named '${trimmed}' already exists.` });
      return false;
    }

    const nextLayouts = get().layouts.map((layout) =>
      layout.id === layoutId
        ? {
            ...layout,
            name: trimmed,
            updatedAt: now,
          }
        : layout
    );

    if (nextLayouts.length === get().layouts.length && !nextLayouts.some((layout) => layout.id === layoutId)) {
      set({ lastError: 'Layout not found.' });
      return false;
    }

    const payload: LayoutLibraryPayload = {
      schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
      layouts: nextLayouts,
      activeLayoutId: get().activeLayoutId,
    };

    persistPayload(payload);
    set({ layouts: nextLayouts, lastError: null });
    return true;
  },

  deleteLayout: (layoutId) => {
    const nextLayouts = get().layouts.filter((layout) => layout.id !== layoutId);
    if (nextLayouts.length === get().layouts.length) {
      set({ lastError: 'Layout not found.' });
      return false;
    }

    const nextActiveLayoutId = get().activeLayoutId === layoutId ? null : get().activeLayoutId;

    const payload: LayoutLibraryPayload = {
      schemaVersion: LAYOUT_LIBRARY_SCHEMA_VERSION,
      layouts: nextLayouts,
      activeLayoutId: nextActiveLayoutId,
    };

    persistPayload(payload);
    set({ layouts: nextLayouts, activeLayoutId: nextActiveLayoutId, lastError: null });
    return true;
  },

  clearError: () => {
    set({ lastError: null });
  },
}));

export function getLayoutLibraryLastError(): string | null {
  return useLayoutLibraryStore.getState().lastError;
}
