import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutConfig } from 'golden-layout';

const captureLayoutMock = vi.fn();
const applyLayoutMock = vi.fn();
const resetToDefaultLayoutMock = vi.fn();

vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({
    captureLayout: captureLayoutMock,
    applyLayout: applyLayoutMock,
    resetToDefaultLayout: resetToDefaultLayoutMock,
  }),
}));

const STORAGE_KEY = 'brainflow2-layout-library';

const TEST_LAYOUT: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      { type: 'column', content: [] },
      { type: 'stack', content: [] },
      { type: 'column', content: [] },
    ],
  },
} as LayoutConfig;

async function loadFreshStore() {
  vi.resetModules();
  return await import('@/stores/layoutLibraryStore');
}

describe('layoutLibraryStore', () => {
  beforeEach(() => {
    localStorage.clear();
    captureLayoutMock.mockReset();
    applyLayoutMock.mockReset();
    resetToDefaultLayoutMock.mockReset();
  });

  it('falls back to empty state for corrupted persisted data', async () => {
    localStorage.setItem(STORAGE_KEY, '{"schemaVersion":1,"layouts":"broken"}');

    const { useLayoutLibraryStore } = await loadFreshStore();
    const state = useLayoutLibraryStore.getState();

    expect(state.layouts).toEqual([]);
    expect(state.activeLayoutId).toBeNull();
  });

  it('ignores incompatible schema versions', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 999,
        activeLayoutId: 'layout-1',
        layouts: [
          {
            id: 'layout-1',
            name: 'Old Layout',
            schemaVersion: 999,
            createdAt: 1,
            updatedAt: 1,
            layoutConfig: TEST_LAYOUT,
          },
        ],
      })
    );

    const { useLayoutLibraryStore } = await loadFreshStore();
    const state = useLayoutLibraryStore.getState();

    expect(state.layouts).toEqual([]);
    expect(state.activeLayoutId).toBeNull();
  });

  it('supports save, rename, load, and delete workflow', async () => {
    captureLayoutMock.mockReturnValue(TEST_LAYOUT);
    applyLayoutMock.mockReturnValue(true);

    const { useLayoutLibraryStore } = await loadFreshStore();
    const store = useLayoutLibraryStore.getState();

    const saved = store.saveCurrentLayout('My Layout');
    expect(saved).toBe(true);
    expect(useLayoutLibraryStore.getState().layouts).toHaveLength(1);

    const layoutId = useLayoutLibraryStore.getState().layouts[0].id;
    const renamed = useLayoutLibraryStore.getState().renameLayout(layoutId, 'Renamed Layout');
    expect(renamed).toBe(true);
    expect(useLayoutLibraryStore.getState().layouts[0].name).toBe('Renamed Layout');

    const loaded = useLayoutLibraryStore.getState().loadLayout(layoutId);
    expect(loaded).toBe(true);
    expect(useLayoutLibraryStore.getState().activeLayoutId).toBe(layoutId);

    const deleted = useLayoutLibraryStore.getState().deleteLayout(layoutId);
    expect(deleted).toBe(true);
    expect(useLayoutLibraryStore.getState().layouts).toHaveLength(0);
    expect(useLayoutLibraryStore.getState().activeLayoutId).toBeNull();
  });

  it('recovers with default layout when loading fails', async () => {
    captureLayoutMock.mockReturnValue(TEST_LAYOUT);
    applyLayoutMock.mockReturnValue(false);
    resetToDefaultLayoutMock.mockReturnValue(true);

    const { useLayoutLibraryStore } = await loadFreshStore();
    const store = useLayoutLibraryStore.getState();

    expect(store.saveCurrentLayout('Recovery Test')).toBe(true);
    const layoutId = useLayoutLibraryStore.getState().layouts[0].id;

    const loaded = useLayoutLibraryStore.getState().loadLayout(layoutId);
    expect(loaded).toBe(false);
    expect(resetToDefaultLayoutMock).toHaveBeenCalledTimes(1);
    expect(useLayoutLibraryStore.getState().lastError).toContain('Recovered with default layout');
  });
});
