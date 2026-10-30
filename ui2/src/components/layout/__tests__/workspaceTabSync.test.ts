import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldenLayout, type Stack } from 'golden-layout';

import { createDefaultLayoutConfig } from '@/services/layoutService';
import {
  ProgrammaticTabChange,
  addWorkspaceTabKeepingActive,
  focusWorkspaceTab,
  handleWorkspaceTabDestroyed,
  programmaticTabRemoval,
  shouldSyncStoreFromTab,
  tabWorkspaceId,
} from '../workspaceTabSync';

let layout: GoldenLayout | null = null;
let host: HTMLDivElement | null = null;

function mountLayout() {
  host = document.createElement('div');
  document.body.appendChild(host);
  layout = new GoldenLayout(host);
  for (const type of ['FileBrowser', 'StudioDesignPanel', 'Inspector', 'Workspace']) {
    layout.registerComponent(type, () => {});
  }
  layout.loadLayout(createDefaultLayoutConfig());
  const centre = layout.rootItem!.contentItems[1] as Stack;
  return { layout, centre };
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
});

afterEach(() => {
  layout?.destroy();
  layout = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const workspaceTab = (workspaceId: string) => ({
  type: 'component' as const,
  componentType: 'Workspace',
  title: workspaceId,
  componentState: { workspaceId, workspaceType: 'integrated' },
});

describe('workspace tab sync', () => {
  it('rehydrating tabs keeps the persisted active workspace in front and never moves the store', () => {
    const { layout, centre } = mountLayout();
    const guard = new ProgrammaticTabChange();
    // The store, restored from disk: "integrated-3" was active; tabs are
    // re-added in map order, so later tabs are added after it.
    let storeActive = 'integrated-3';
    layout.on('activeContentItemChanged', (item) => {
      const id = tabWorkspaceId(item);
      if (shouldSyncStoreFromTab(id, storeActive, guard)) storeActive = id;
    });

    for (const id of ['orthogonal-1', 'integrated-2', 'integrated-3', 'integrated-4']) {
      addWorkspaceTabKeepingActive(
        centre,
        guard,
        () => centre.addItem(workspaceTab(id)),
        storeActive,
      );
    }

    expect(storeActive).toBe('integrated-3');
    expect(tabWorkspaceId(centre.getActiveComponentItem())).toBe('integrated-3');
  });

  it('a new workspace tab comes to the front when it is the active one', () => {
    const { centre } = mountLayout();
    const guard = new ProgrammaticTabChange();
    addWorkspaceTabKeepingActive(centre, guard, () => centre.addItem(workspaceTab('a')), 'a');
    addWorkspaceTabKeepingActive(centre, guard, () => centre.addItem(workspaceTab('b')), 'b');
    expect(tabWorkspaceId(centre.getActiveComponentItem())).toBe('b');
  });

  it('user tab changes still sync to the store', () => {
    const { layout, centre } = mountLayout();
    const guard = new ProgrammaticTabChange();
    let storeActive: string | null = 'a';
    layout.on('activeContentItemChanged', (item) => {
      const id = tabWorkspaceId(item);
      if (shouldSyncStoreFromTab(id, storeActive, guard)) storeActive = id;
    });
    addWorkspaceTabKeepingActive(
      centre,
      guard,
      () => centre.addItem(workspaceTab('a')),
      storeActive,
    );
    addWorkspaceTabKeepingActive(
      centre,
      guard,
      () => centre.addItem(workspaceTab('b')),
      storeActive,
    );
    expect(storeActive).toBe('a');

    // A click on tab "b" (outside the guard) activates it in the store.
    focusWorkspaceTab(centre, 'b');
    expect(storeActive).toBe('b');
    expect(tabWorkspaceId(centre.getActiveComponentItem())).toBe('b');
  });

  it('focusWorkspaceTab reports a missing tab', () => {
    const { centre } = mountLayout();
    expect(focusWorkspaceTab(centre, 'nope')).toBe(false);
    expect(focusWorkspaceTab(centre, null)).toBe(false);
  });
});

describe('handleWorkspaceTabDestroyed (tab × vs app-driven removal)', () => {
  it("closes the workspace when the user closed the tab, and forgets the tab", () => {
    const guard = new ProgrammaticTabChange();
    const forget = vi.fn();
    const close = vi.fn();
    expect(handleWorkspaceTabDestroyed('ws-1', guard, forget, close)).toBe('closed');
    expect(forget).toHaveBeenCalledWith('ws-1');
    expect(close).toHaveBeenCalledWith('ws-1');
  });

  it('only forgets the tab for removals the app makes (store close, layout reload, teardown)', () => {
    const forget = vi.fn();
    const close = vi.fn();
    const result = programmaticTabRemoval.run(() =>
      handleWorkspaceTabDestroyed('ws-1', programmaticTabRemoval, forget, close),
    );
    expect(result).toBe('forgotten');
    expect(forget).toHaveBeenCalledWith('ws-1');
    expect(close).not.toHaveBeenCalled();
    expect(programmaticTabRemoval.active).toBe(false);
  });
});
