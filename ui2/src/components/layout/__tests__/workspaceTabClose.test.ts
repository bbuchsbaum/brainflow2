/**
 * Closing a tab with GoldenLayout's × closes its workspace (review C1,
 * qa-design-decisions-2026-10-30 §1). Real GoldenLayout + real workspace store;
 * the Workspace component's destroy handler is the one GoldenLayoutRoot uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldenLayout, type ComponentItem, type Stack } from 'golden-layout';

import { createDefaultLayoutConfig } from '@/services/layoutService';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import { ensureDefaultView, openTool } from '@/services/workspaceNavigation';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ensureCentreStack } from '../centreStack';
import {
  handleWorkspaceTabDestroyed,
  programmaticTabRemoval,
  tabWorkspaceId,
} from '../workspaceTabSync';

let layout: GoldenLayout | null = null;
let host: HTMLDivElement | null = null;
const forgotten: string[] = [];

const store = () => useWorkspaceStore.getState();

function mountLayout(): Stack {
  host = document.createElement('div');
  document.body.appendChild(host);
  layout = new GoldenLayout(host);
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector']) {
    layout.registerComponent(type, () => {});
  }
  layout.registerComponent('Workspace', (container, state) => {
    const { workspaceId } = state as { workspaceId: string };
    container.on('destroy', () => {
      handleWorkspaceTabDestroyed(
        workspaceId,
        programmaticTabRemoval,
        (id) => forgotten.push(id),
        (id) => useWorkspaceStore.getState().closeWorkspace(id),
      );
    });
  });
  layout.loadLayout(createDefaultLayoutConfig());
  // As GoldenLayoutRoot does: the centre stack's last-tab × (centreStack.ts).
  return ensureCentreStack(layout)!;
}

function addTab(centre: Stack, workspaceId: string) {
  const workspace = store().workspaces.get(workspaceId)!;
  centre.addItem({
    type: 'component',
    componentType: 'Workspace',
    title: workspaceId,
    componentState: { workspaceId, workspaceType: workspace.type },
  });
}

/** Click the tab's × like a user. */
function clickTabClose(centre: Stack, workspaceId: string) {
  const item = centre.contentItems.find((i) => tabWorkspaceId(i) === workspaceId) as ComponentItem;
  const close = item.tab.closeElement;
  if (!close) throw new Error(`tab ${workspaceId} has no close button`);
  close.click();
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
  forgotten.length = 0;
});

afterEach(() => {
  if (layout) {
    const l = layout;
    programmaticTabRemoval.run(() => l.destroy());
  }
  layout = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('closing a workspace tab with ×', () => {
  it('closes the tool, so Cmd+5 opens a new Set studio tab in front', async () => {
    const view = await store().createWorkspace('orthogonal-flexible');
    const studio = await openTool('set-studio');
    const centre = mountLayout();
    addTab(centre, view);
    addTab(centre, studio);

    clickTabClose(centre, studio);

    expect(store().workspaces.has(studio)).toBe(false);
    expect(store().activeWorkspaceId).toBe(view);
    expect(forgotten).toContain(studio);

    const reopened = await openTool('set-studio');
    expect(reopened).not.toBe(studio);
    expect(store().activeWorkspaceId).toBe(reopened);
  });

  it('closing the last tab leaves no workspace, and the default view comes back', async () => {
    const view = await store().createWorkspace('mosaic');
    const centre = mountLayout();
    addTab(centre, view);

    clickTabClose(centre, view);
    expect(store().workspaces.size).toBe(0);

    // GoldenLayoutRoot's empty-map effect.
    const created = await ensureDefaultView();
    expect(store().workspaces.size).toBe(1);
    expect(store().workspaces.get(created!)?.type).toBe('orthogonal-flexible');
  });

  it('a closed tab does not come back on relaunch', async () => {
    const keep = await store().createWorkspace('mosaic');
    const closed = await store().createWorkspace('comparison');
    const centre = mountLayout();
    addTab(centre, keep);
    addTab(centre, closed);

    clickTabClose(centre, closed);
    // Relaunch: a fresh in-memory store reads what was saved on disk.
    const saved = localStorage.getItem('brainflow2-workspace');
    expect(saved).not.toBeNull();
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
    localStorage.setItem('brainflow2-workspace', saved!);
    await useWorkspaceStore.persist.rehydrate();

    expect([...store().workspaces.keys()]).toEqual([keep]);
  });

  it('a layout reload (Reset layout) destroys the tabs without closing their workspaces', async () => {
    const view = await store().createWorkspace('mosaic');
    const centre = mountLayout();
    addTab(centre, view);

    const l = layout!;
    programmaticTabRemoval.run(() => l.loadLayout(createDefaultLayoutConfig()));

    expect(forgotten).toContain(view);
    expect(store().workspaces.has(view)).toBe(true);
  });
});
