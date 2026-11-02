import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSurfaceStore } from '@/stores/surfaceStore';
import {
  createDefaultLayoutConfig,
  findComponentItemsByType,
  getLayoutService,
  resolvePanelComponentType,
} from '../layoutService';

/**
 * QA 2026-10-29 §16: Cmd+B / View › Panels focus the existing panel wherever
 * it is docked instead of stacking duplicates; Reset layout restores the
 * default shell and keeps the surface view tabs.
 */

interface FakeItem {
  type: string;
  componentType?: string;
  title?: string;
  container?: { initialState: Record<string, unknown> };
  contentItems: FakeItem[];
  parent: FakeItem | null;
  addChild?: ReturnType<typeof vi.fn>;
  addItem?: ReturnType<typeof vi.fn>;
  setActiveComponentItem?: ReturnType<typeof vi.fn>;
}

function component(componentType: string, state: Record<string, unknown> = {}): FakeItem {
  return {
    type: 'component',
    componentType,
    title: componentType,
    container: { initialState: state },
    contentItems: [],
    parent: null,
  };
}

function stack(children: FakeItem[]): FakeItem {
  const item: FakeItem = {
    type: 'stack',
    contentItems: [],
    parent: null,
    setActiveComponentItem: vi.fn(),
  };
  item.addChild = vi.fn((child: FakeItem) => {
    child.parent = item;
    item.contentItems.push(child);
  });
  // Stack.addItem: build the component from its config, add it, return its index.
  item.addItem = vi.fn(
    (config: { componentType: string; componentState?: Record<string, unknown> }) => {
      item.addChild!(component(config.componentType, config.componentState ?? {}));
      return item.contentItems.length - 1;
    },
  );
  children.forEach((child) => item.addChild!(child));
  item.addChild.mockClear();
  return item;
}

function node(type: string, children: FakeItem[]): FakeItem {
  const item: FakeItem = { type, contentItems: children, parent: null };
  children.forEach((child) => (child.parent = item));
  return item;
}

function makeLayout() {
  const files = component('FileBrowser');
  const inspector = component('Inspector');
  const left = stack([files, component('StudioDesignPanel')]);
  const center = stack([component('Workspace', { workspaceId: 'w1' })]);
  const right = stack([inspector]);
  const layout = {
    rootItem: node('row', [node('column', [left]), center, node('column', [right])]),
    newItem: vi.fn((config: { componentType: string; componentState?: Record<string, unknown> }) =>
      component(config.componentType, config.componentState ?? {}),
    ),
    addComponent: vi.fn(),
    loadLayout: vi.fn(),
  };
  return { layout, files, inspector, left, center, right };
}

describe('layoutService.showPanel', () => {
  let fixture: ReturnType<typeof makeLayout>;

  beforeEach(() => {
    fixture = makeLayout();
    getLayoutService().setLayoutRef(fixture.layout);
  });

  afterEach(() => vi.clearAllMocks());

  it('focuses the existing Files panel instead of adding another (Cmd+B x3)', () => {
    const service = getLayoutService();
    service.showPanel('FileBrowser');
    service.showPanel('FileBrowser');
    service.showPanel('FileBrowser');
    expect(fixture.layout.newItem).not.toHaveBeenCalled();
    expect(fixture.left.setActiveComponentItem).toHaveBeenCalledTimes(3);
    expect(fixture.left.setActiveComponentItem).toHaveBeenCalledWith(fixture.files, true);
    expect(findComponentItemsByType(fixture.layout.rootItem as never, 'FileBrowser')).toHaveLength(1);
  });

  it('maps Layer Manager (LayerPanel) and the other legacy aliases onto the one Inspector', () => {
    for (const legacy of ['LayerPanel', 'AtlasPanel', 'SurfacePanel', 'StudioInspectorPanel']) {
      expect(resolvePanelComponentType(legacy)).toBe('Inspector');
      getLayoutService().showPanel(legacy);
    }
    expect(fixture.layout.newItem).not.toHaveBeenCalled();
    expect(fixture.right.setActiveComponentItem).toHaveBeenCalledWith(fixture.inspector, true);
  });

  it('finds a panel the user dragged into another stack', () => {
    // Move Files into the right-hand stack.
    fixture.left.contentItems.splice(fixture.left.contentItems.indexOf(fixture.files), 1);
    fixture.right.addChild!(fixture.files);
    getLayoutService().showPanel('FileBrowser');
    expect(fixture.layout.newItem).not.toHaveBeenCalled();
    expect(fixture.right.setActiveComponentItem).toHaveBeenCalledWith(fixture.files, true);
  });

  it('re-adds a closed panel to its home stack, once', () => {
    fixture.left.contentItems.splice(fixture.left.contentItems.indexOf(fixture.files), 1);
    const service = getLayoutService();
    service.showPanel('FileBrowser');
    service.showPanel('FileBrowser');
    expect(fixture.left.addItem).toHaveBeenCalledTimes(1);
    expect(fixture.left.addChild).toHaveBeenCalledTimes(1);
    expect(findComponentItemsByType(fixture.layout.rootItem as never, 'FileBrowser')).toHaveLength(1);
  });
});

describe('layoutService.resetToDefaultLayout', () => {
  it('loads the default shell and carries surface view tabs across', () => {
    const fixture = makeLayout();
    const surface = component('surfaceView', { surfaceHandle: 's1', path: '/a/lh.pial.gii' });
    fixture.center.addChild!(surface);
    const freshCenter = stack([]);
    fixture.layout.loadLayout.mockImplementation(() => {
      fixture.layout.rootItem = node('row', [node('column', [stack([])]), freshCenter, node('column', [stack([])])]);
    });
    getLayoutService().setLayoutRef(fixture.layout);

    expect(getLayoutService().resetToDefaultLayout()).toBe(true);
    expect(fixture.layout.loadLayout).toHaveBeenCalledWith(createDefaultLayoutConfig());
    const restored = findComponentItemsByType(fixture.layout.rootItem as never, 'surfaceView');
    expect(restored).toHaveLength(1);
    expect(restored[0].container.initialState).toEqual({ surfaceHandle: 's1', path: '/a/lh.pial.gii' });
  });

  it("keeps the surface tab's per-view settings although the old panel unmounts after the reload", () => {
    const fixture = makeLayout();
    fixture.center.addChild!(
      component('surfaceView', { surfaceHandle: 's1', surfaceViewId: 'sv-1' }),
    );
    fixture.layout.loadLayout.mockImplementation(() => {
      fixture.layout.rootItem = node('row', [node('column', [stack([])]), stack([]), node('column', [stack([])])]);
    });
    getLayoutService().setLayoutRef(fixture.layout);

    const store = useSurfaceStore.getState();
    store.registerSurfaceView('sv-1', 's1', 'old-panel');
    store.updateSurfaceViewDisplaySettings('sv-1', { wireframe: true });
    store.setViewpoint('ventral', 'sv-1');

    expect(getLayoutService().resetToDefaultLayout()).toBe(true);
    // The destroyed panel's deferred cleanup runs after the reload.
    useSurfaceStore.getState().unregisterSurfaceView('sv-1', 'old-panel');
    // The remounted tab (same id) claims the view.
    useSurfaceStore.getState().registerSurfaceView('sv-1', 's1', 'new-panel');

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewHandles.get('sv-1')).toBe('s1');
    expect(state.surfaceViewSettings.get('sv-1')?.displaySettings.wireframe).toBe(true);
    expect(state.surfaceViewViewpoints.get('sv-1')).toBe('ventral');
  });

  it('default shell has Files/Subjects, an empty centre and only registered panels', () => {
    const config = createDefaultLayoutConfig();
    const types = JSON.stringify(config).match(/"componentType":"[^"]+"/g);
    expect(types).toEqual([
      '"componentType":"FileBrowser"',
      '"componentType":"StudioDesignPanel"',
      '"componentType":"Inspector"',
    ]);
    expect(config.header).toEqual({ popout: false, tabDropdown: 'More tabs' });
  });
});
