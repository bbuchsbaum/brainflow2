/**
 * QA 2026-10-30 F1: the centre stack's own × removed every tab, the bottom
 * dock went with them, no default view appeared and only Reset Layout
 * recovered. Real GoldenLayout + real workspace store, wired the way
 * GoldenLayoutRoot wires them (tab destroy → closeWorkspace; store close →
 * removeClosedWorkspaceTab; store add → a tab in ensureCentreStack).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldenLayout, type ComponentItem } from 'golden-layout';

import { createDefaultLayoutConfig } from '@/services/layoutService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import { ensureDefaultView, openTool } from '@/services/workspaceNavigation';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ensureCentreStack, getCentreStack } from '../centreStack';
import {
  handleWorkspaceTabDestroyed,
  programmaticTabRemoval,
  removeClosedWorkspaceTab,
  tabWorkspaceId,
} from '../workspaceTabSync';

let layout: GoldenLayout | null = null;
let host: HTMLDivElement | null = null;
let unsubscribe: (() => void) | null = null;
const tracked = new Set<string>();

const store = () => useWorkspaceStore.getState();

function mountLayout(): GoldenLayout {
  host = document.createElement('div');
  document.body.appendChild(host);
  const gl = new GoldenLayout(host);
  layout = gl;
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector']) {
    gl.registerComponent(type, () => {});
  }
  gl.registerComponent('Workspace', (container, state) => {
    const { workspaceId } = state as { workspaceId: string };
    container.on('destroy', () => {
      handleWorkspaceTabDestroyed(
        workspaceId,
        programmaticTabRemoval,
        (id) => tracked.delete(id),
        (id) => store().closeWorkspace(id),
      );
    });
  });
  gl.loadLayout(createDefaultLayoutConfig());
  ensureCentreStack(gl);

  const addTab = (id: string) => {
    const centre = ensureCentreStack(gl);
    const workspace = store().workspaces.get(id);
    if (!centre || !workspace) return;
    centre.addItem({
      type: 'component',
      componentType: 'Workspace',
      title: id,
      componentState: { workspaceId: id, workspaceType: workspace.type },
    });
    tracked.add(id);
  };
  store().workspaces.forEach((_, id) => addTab(id));
  unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
    state.workspaces.forEach((_, id) => {
      if (!prev.workspaces.has(id)) addTab(id);
    });
    prev.workspaces.forEach((_, id) => {
      if (state.workspaces.has(id)) return;
      removeClosedWorkspaceTab(getCentreStack(gl), id);
      tracked.delete(id);
    });
  });
  return gl;
}

function centreWorkspaceIds(gl: GoldenLayout): string[] {
  return (getCentreStack(gl)?.contentItems ?? []).map((item) => tabWorkspaceId(item) ?? '?');
}

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
  tracked.clear();
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

describe('the centre stack', () => {
  it('has no stack-level ×; its tabs keep their own', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    const centre = getCentreStack(gl)!;

    expect(centre.header.controlsContainerElement.querySelector('.lm_close')).toBeNull();
    const tab = centre.contentItems.find((i) => tabWorkspaceId(i) === view) as ComponentItem;
    expect(tab.tab.closeElement).not.toBeNull();
    // The side stacks keep theirs.
    const left = gl.rootItem!.contentItems[0].contentItems[0];
    expect(left.element.querySelector('.lm_controls .lm_close')).not.toBeNull();
  });

  it('closing the last tab keeps a centre, and the default view lands in it', async () => {
    const view = await store().createWorkspace('mosaic');
    const gl = mountLayout();
    const tab = getCentreStack(gl)!.contentItems[0] as ComponentItem;

    tab.tab.closeElement!.click();
    expect(store().workspaces.size).toBe(0);

    const created = await ensureDefaultView();
    expect(created).not.toBe(view);
    expect(centreWorkspaceIds(gl)).toEqual([created]);
    expect(gl.rootItem!.contentItems.map((i) => i.type)).toEqual(['column', 'stack', 'column']);
  });

  it('a stack removed with all its tabs closes every workspace, then the default view returns', async () => {
    await store().createWorkspace('mosaic');
    await store().createWorkspace('orthogonal-flexible');
    await openTool('set-studio');
    const gl = mountLayout();
    expect(centreWorkspaceIds(gl)).toHaveLength(3);

    // The path the old stack × took: a user-driven removal of the stack.
    getCentreStack(gl)!.remove();

    // No workspace survives behind a missing tab (the stale "In Studio" pill).
    expect(store().workspaces.size).toBe(0);
    expect(store().activeWorkspaceId).toBeNull();

    const created = await ensureDefaultView();
    expect(centreWorkspaceIds(gl)).toEqual([created]);
    expect(store().activeWorkspaceId).toBe(created);
  });
});
