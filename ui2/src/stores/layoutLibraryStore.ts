import { create } from 'zustand';
import type { LayoutConfig } from 'golden-layout';
import { getLayoutService } from '@/services/layoutService';

const STORAGE_KEY = 'brainflow2-layout-library';
const LAYOUT_LIBRARY_SCHEMA_VERSION = 1;

export interface NamedLayout {
  id: string;
  name: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  layoutConfig: LayoutConfig;
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

function cloneLayoutConfig(config: LayoutConfig): LayoutConfig {
  return JSON.parse(JSON.stringify(config)) as LayoutConfig;
}

function isLayoutConfig(value: unknown): value is LayoutConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeRoot = (value as { root?: unknown }).root;
  return Boolean(maybeRoot && typeof maybeRoot === 'object');
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
      .map((entry) => ({
        ...entry,
        layoutConfig: cloneLayoutConfig(entry.layoutConfig),
      }));

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

    const didLoad = getLayoutService().applyLayout(layout.layoutConfig);
    if (!didLoad) {
      const recovered = getLayoutService().resetToDefaultLayout();
      set({
        lastError: recovered
          ? `Layout '${layout.name}' could not be restored. Recovered with default layout.`
          : `Layout '${layout.name}' could not be restored.`,
      });
      return false;
    }

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
