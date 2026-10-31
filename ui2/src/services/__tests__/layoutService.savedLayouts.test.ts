/**
 * QA 2026-10-30 F2: Workspace › <saved layout> always said "could not be
 * restored. Recovered with default layout." and then changed nothing.
 * `saveLayout()` returns a resolved config that `loadLayout()` rejects, so
 * every restore threw. Round trip against real GoldenLayout, the real layout
 * service and the real stores: save → change → restore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldenLayout, type ComponentItem, type Stack } from 'golden-layout';

import {
  createDefaultLayoutConfig,
  findComponentItemsByType,
  getLayoutService,
} from '../layoutService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useLayoutLibraryStore } from '@/stores/layoutLibraryStore';
import { getCentreStack } from '@/components/layout/centreStack';
import {
  focusWorkspaceTab,
  handleWorkspaceTabDestroyed,
  programmaticTabChange,
  programmaticTabRemoval,
  removeClosedWorkspaceTab,
  shouldSyncStoreFromTab,
  tabWorkspaceId,
} from '@/components/layout/workspaceTabSync';

let layout: GoldenLayout | null = null;
let host: HTMLDivElement | null = null;
let unsubscribe: (() => void) | null = null;

const store = () => useWorkspaceStore.getState();

function mountLayout(): GoldenLayout {
  host = document.createElement('div');
  document.body.appendChild(host);
  const gl = new GoldenLayout(host);
  layout = gl;
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector', 'surfaceView']) {
    gl.registerComponent(type, () => {});
  }
  // Wired like GoldenLayoutRoot: a tab's × closes its workspace, a store close
  // removes the tab, and a user tab switch activates the workspace.
  gl.registerComponent('Workspace', (container, state) => {
    const { workspaceId } = state as { workspaceId: string };
    container.on('destroy', () => {
      handleWorkspaceTabDestroyed(
        workspaceId,
        programmaticTabRemoval,
        () => {},
        (id) => store().closeWorkspace(id),
      );
    });
  });
  gl.on('activeContentItemChanged', (item) => {
    const id = tabWorkspaceId(item);
    if (shouldSyncStoreFromTab(id, store().activeWorkspaceId, programmaticTabChange)) {
      store().activateWorkspace(id);
    }
  });
  unsubscribe = useWorkspaceStore.subscribe((next, prev) => {
    prev.workspaces.forEach((_, id) => {
      if (!next.workspaces.has(id)) removeClosedWorkspaceTab(getCentreStack(gl), id);
    });
  });
  gl.loadLayout(createDefaultLayoutConfig());
  getLayoutService().setLayoutRef(gl);
  return gl;
}

function addTab(gl: GoldenLayout, workspaceId: string) {
  getCentreStack(gl)!.addItem({
    type: 'component',
    componentType: 'Workspace',
    title: workspaceId,
    componentState: { workspaceId, workspaceType: store().workspaces.get(workspaceId)!.type },
  });
}

const centreIds = (gl: GoldenLayout) =>
  getCentreStack(gl)!.contentItems.map((item) => tabWorkspaceId(item) ?? item.title);

const panelCount = (gl: GoldenLayout, type: string) =>
  findComponentItemsByType(gl.rootItem, type).length;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  initializeViewRegistry();
  useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
  useLayoutLibraryStore.setState({ layouts: [], activeLayoutId: null, lastError: null });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  if (layout) {
    const l = layout;
    programmaticTabRemoval.run(() => l.destroy());
  }
  layout = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('saved layouts', () => {
  it('save → change → restore brings back the panels, the tab layout and the dock', async () => {
    const other = await store().createWorkspace('mosaic');
    const front = await store().createWorkspace('orthogonal-locked');
    const gl = mountLayout();
    addTab(gl, other);
    addTab(gl, front);

    // Saved state: Subjects closed, front tab orthogonal, dock on Log.
    (findComponentItemsByType(gl.rootItem, 'StudioDesignPanel')[0] as ComponentItem).remove();
    useLayoutSettingsStore.getState().setBottomDockActiveTab('log');
    expect(useLayoutLibraryStore.getState().saveCurrentLayout('qa-run3')).toBe(true);
    const saved = useLayoutLibraryStore.getState().layouts[0];
    expect(saved.view?.workspaceType).toBe('orthogonal-locked');

    // Change everything the layout covers.
    getLayoutService().showPanel('StudioDesignPanel');
    store().setActiveWorkspaceMode('mosaic');
    useLayoutSettingsStore.getState().setBottomDockActiveTab('plot');
    expect(panelCount(gl, 'StudioDesignPanel')).toBe(1);

    expect(useLayoutLibraryStore.getState().loadLayout(saved.id)).toBe(true);
    expect(useLayoutLibraryStore.getState().lastError).toBeNull();

    expect(panelCount(gl, 'StudioDesignPanel')).toBe(0);
    expect(panelCount(gl, 'FileBrowser')).toBe(1);
    expect(panelCount(gl, 'Inspector')).toBe(1);
    expect(store().workspaces.get(front)?.type).toBe('orthogonal-locked');
    expect(store().workspaces.get(other)?.type).toBe('mosaic');
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('log');
    // Every workspace tab comes back once, in the centre, with the front tab in front.
    expect(centreIds(gl).sort()).toEqual([front, other].sort());
    expect(panelCount(gl, 'Workspace')).toBe(2);
    expect(tabWorkspaceId(getCentreStack(gl)!.getActiveComponentItem())).toBe(front);
  });

  it('restores a layout saved before the fix (stored in resolved form)', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    (findComponentItemsByType(gl.rootItem, 'StudioDesignPanel')[0] as ComponentItem).remove();
    const resolved = gl.saveLayout();
    getLayoutService().showPanel('StudioDesignPanel');

    expect(getLayoutService().applyLayout(resolved)).toBe('applied');
    expect(panelCount(gl, 'StudioDesignPanel')).toBe(0);
    expect(centreIds(gl)).toEqual([view]);
  });

  it('keeps surface tabs across a restore', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    expect(useLayoutLibraryStore.getState().saveCurrentLayout('with-surface')).toBe(true);
    getCentreStack(gl)!.addItem({
      type: 'component',
      componentType: 'surfaceView',
      title: 'fsaverage5 pial',
      componentState: { surfaceHandle: 's1', surfaceViewId: 'sv1' },
    });

    const saved = useLayoutLibraryStore.getState().layouts[0];
    expect(useLayoutLibraryStore.getState().loadLayout(saved.id)).toBe(true);
    expect(panelCount(gl, 'surfaceView')).toBe(1);
    expect(panelCount(gl, 'Workspace')).toBe(1);
  });

  // Review H2: after a reload, ⌘W / File › Close Tab (a store close) left the
  // re-added tab behind.
  it('a tab re-added by Reset layout or a restore still closes from the store', async () => {
    const keep = await store().createWorkspace('mosaic');
    const closeAfterReset = await store().createWorkspace('comparison');
    const closeAfterRestore = await store().createWorkspace('orthogonal-locked');
    const gl = mountLayout();
    [keep, closeAfterReset, closeAfterRestore].forEach((id) => addTab(gl, id));

    expect(getLayoutService().resetToDefaultLayout()).toBe(true);
    store().closeWorkspace(closeAfterReset);
    expect(centreIds(gl).sort()).toEqual([keep, closeAfterRestore].sort());

    expect(useLayoutLibraryStore.getState().saveCurrentLayout('after-reset')).toBe(true);
    const saved = useLayoutLibraryStore.getState().layouts[0];
    expect(useLayoutLibraryStore.getState().loadLayout(saved.id)).toBe(true);
    store().closeWorkspace(closeAfterRestore);
    expect(centreIds(gl)).toEqual([keep]);
  });

  // Review M3: each re-added tab came to the front and moved the store.
  it('Reset layout keeps the active tab in front and active', async () => {
    const first = await store().createWorkspace('mosaic');
    const middle = await store().createWorkspace('comparison');
    const last = await store().createWorkspace('orthogonal-locked');
    const gl = mountLayout();
    [first, middle, last].forEach((id) => addTab(gl, id));
    store().activateWorkspace(middle);
    focusWorkspaceTab(getCentreStack(gl)!, middle);

    expect(getLayoutService().resetToDefaultLayout()).toBe(true);

    expect(store().activeWorkspaceId).toBe(middle);
    expect(tabWorkspaceId(getCentreStack(gl)!.getActiveComponentItem())).toBe(middle);
    expect(centreIds(gl)).toHaveLength(3);
  });

  // Review L1: a surface tab docked in a side stack was saved with the layout
  // and also carried across, so it came back twice (or dead, once closed).
  it('never restores surface tabs from the saved copy', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    const left = gl.rootItem!.contentItems[0].contentItems[0] as Stack;
    left.addItem({
      type: 'component',
      componentType: 'surfaceView',
      title: 'fsaverage5 pial',
      componentState: { surfaceHandle: 's1', surfaceViewId: 'sv1' },
    });
    expect(useLayoutLibraryStore.getState().saveCurrentLayout('side-surface')).toBe(true);
    const saved = useLayoutLibraryStore.getState().layouts[0];
    expect(JSON.stringify(saved.layoutConfig)).not.toContain('surfaceView');

    // Still open: carried across once.
    expect(useLayoutLibraryStore.getState().loadLayout(saved.id)).toBe(true);
    expect(panelCount(gl, 'surfaceView')).toBe(1);

    // Closed since: not brought back.
    findComponentItemsByType(gl.rootItem, 'surfaceView')[0].remove();
    expect(useLayoutLibraryStore.getState().loadLayout(saved.id)).toBe(true);
    expect(panelCount(gl, 'surfaceView')).toBe(0);
    expect(gl.rootItem!.contentItems.map((i) => i.type)).toEqual(['column', 'stack', 'column']);
  });

  it('strips surface tabs from a layout saved before this fix', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    const left = gl.rootItem!.contentItems[0].contentItems[0] as Stack;
    left.addItem({
      type: 'component',
      componentType: 'surfaceView',
      title: 'old',
      componentState: { surfaceHandle: 'gone', surfaceViewId: 'sv-old' },
    });
    const resolved = gl.saveLayout();
    findComponentItemsByType(gl.rootItem, 'surfaceView')[0].remove();

    expect(getLayoutService().applyLayout(resolved)).toBe('applied');
    expect(panelCount(gl, 'surfaceView')).toBe(0);
    expect(centreIds(gl)).toEqual([view]);
  });
});
