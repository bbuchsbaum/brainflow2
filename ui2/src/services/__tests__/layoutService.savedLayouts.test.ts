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
import { whilePlaceholderReloads } from '@/services/surfaceTabReload';
import {
  applyCentreTabOrder,
  centreTabOrder,
  placeholderItemConfig,
} from '@/components/layout/surfaceTabRestore';
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
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector', 'surfaceView', 'surfacePlaceholder']) {
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

  // qa-features-2026-10-31 §9: a placeholder not reloaded yet survives Reset
  // layout like a live surface tab, and is never saved with a layout.
  it('carries surface placeholders across Reset layout and never saves them', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    getCentreStack(gl)!.addItem({
      type: 'component',
      componentType: 'surfacePlaceholder',
      title: 'lh.white.gii',
      componentState: {
        saved: { surfaceViewId: 'sv', title: 'lh.white.gii', sources: [{ kind: 'file', path: '/d/lh.white.gii' }] },
      },
    });

    expect(getLayoutService().resetToDefaultLayout()).toBe(true);
    expect(panelCount(gl, 'surfacePlaceholder')).toBe(1);
    expect(useLayoutLibraryStore.getState().saveCurrentLayout('with-placeholder')).toBe(true);
    expect(JSON.stringify(useLayoutLibraryStore.getState().layouts[0].layoutConfig)).not.toContain(
      'surfacePlaceholder',
    );
  });

  // QA 2026-10-31 N1: File › Close Tab (⌘W) closes the front tab like its ×.
  it('closeFrontTab closes the front view tab and its workspace, or a surface tab', async () => {
    const back = await store().createWorkspace('mosaic');
    const front = await store().createWorkspace('orthogonal-locked');
    const gl = mountLayout();
    addTab(gl, back);
    addTab(gl, front);
    focusWorkspaceTab(getCentreStack(gl)!, front);

    expect(getLayoutService().closeFrontTab()).toBe(true);
    expect(store().workspaces.has(front)).toBe(false);
    expect(centreIds(gl)).toEqual([back]);

    getCentreStack(gl)!.addItem({
      type: 'component',
      componentType: 'surfaceView',
      title: 'lh.pial.gii',
      componentState: { surfaceHandle: 's1', surfaceViewId: 'sv1' },
    });
    expect(getLayoutService().closeFrontTab()).toBe(true);
    expect(panelCount(gl, 'surfaceView')).toBe(0);
    expect(store().workspaces.has(back)).toBe(true);
  });

  // QA 2026-10-31: relaunch put the surface placeholders first, and a
  // reloaded surface tab jumped to the end of the strip.
  it('puts the strip back in its saved order', async () => {
    const a = await store().createWorkspace('mosaic');
    const b = await store().createWorkspace('comparison');
    const gl = mountLayout();
    const centre = getCentreStack(gl)!;
    centre.addItem(
      placeholderItemConfig({ surfaceViewId: 'sv1', title: 'pial', sources: [{ kind: 'file', path: '/d/lh.pial.gii' }] }),
    );
    addTab(gl, a);
    addTab(gl, b);
    expect(centreTabOrder(centre)).toEqual(['sv:sv1', `ws:${a}`, `ws:${b}`]);

    applyCentreTabOrder(centre, [`ws:${a}`, 'sv:sv1', `ws:${b}`]);
    expect(centreTabOrder(centre)).toEqual([`ws:${a}`, 'sv:sv1', `ws:${b}`]);
    // Nothing was destroyed by the moves.
    expect(store().workspaces.size).toBe(2);
  });

  it('a reloaded surface takes its placeholder\'s place in the strip', async () => {
    const a = await store().createWorkspace('mosaic');
    const b = await store().createWorkspace('comparison');
    const gl = mountLayout();
    const centre = getCentreStack(gl)!;
    addTab(gl, a);
    centre.addItem(
      placeholderItemConfig({ surfaceViewId: 'sv1', title: 'lh.pial.gii', sources: [{ kind: 'file', path: '/d/lh.pial.gii' }] }),
    );
    addTab(gl, b);

    getLayoutService().ensureSurfaceView('handle-1', '/d/lh.pial.gii');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const types = centre.contentItems.map((item) => (item as ComponentItem).componentType);
    expect(types).toEqual(['Workspace', 'surfaceView', 'Workspace']);
    expect(panelCount(gl, 'surfacePlaceholder')).toBe(0);
  });

  // Review L1: the centre stack is non-closable by config; a layout saved
  // before that (no flag) is patched on load, so its centre is kept too.
  it('a layout saved without the centre flag gets it on load', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    addTab(gl, view);
    const legacy = createDefaultLayoutConfig();
    delete (legacy.root as { content: Array<Record<string, unknown>> }).content[1].isClosable;
    expect(getLayoutService().applyLayout(legacy)).toBe('applied');
    expect(getCentreStack(gl)!.isClosable).toBe(false);
    expect(getCentreStack(gl)!.header.controlsContainerElement.querySelector('.lm_close')).toBeNull();
  });

  // Review L6: reopening only lh by hand must not discard the lh + rh
  // placeholder; its own Reload replaces it at the first surface back.
  it('a two-source placeholder stays until both are back, unless its own Reload runs', async () => {
    const gl = mountLayout();
    const centre = getCentreStack(gl)!;
    const saved = {
      surfaceViewId: 'sv-pair',
      title: 'pial',
      sources: [
        { kind: 'file' as const, path: '/d/lh.pial.gii' },
        { kind: 'file' as const, path: '/d/rh.pial.gii' },
      ],
    };
    centre.addItem(placeholderItemConfig(saved));
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const types = () => centre.contentItems.map((item) => (item as ComponentItem).componentType);

    getLayoutService().ensureSurfaceView('lh-1', '/d/lh.pial.gii');
    await frame();
    expect(types()).toEqual(['surfacePlaceholder', 'surfaceView']);

    // Its own Reload: the first surface back takes the placeholder's place.
    findComponentItemsByType(gl.rootItem, 'surfaceView')[0].remove();
    await whilePlaceholderReloads('sv-pair', async () => {
      getLayoutService().ensureSurfaceView('lh-2', '/d/lh.pial.gii');
      await frame();
    });
    expect(types()).toEqual(['surfaceView']);
  });
});
