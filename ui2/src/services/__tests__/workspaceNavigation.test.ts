import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useCenterTabStore } from '@/stores/centerTabStore';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import {
  DEFAULT_VIEW_TYPE,
  ensureDefaultView,
  goToWorkspaceType,
  isModalDialogOpen,
  openNewView,
  openTool,
  setCurrentTabLayout,
} from '../workspaceNavigation';

const store = () => useWorkspaceStore.getState();
const types = () => [...store().workspaces.values()].map((w) => w.type);

describe('workspaceNavigation (qa-design-decisions-2026-10-30 §1)', () => {
  beforeEach(() => {
    localStorage.clear();
    initializeViewRegistry();
    useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
    useFeatureFlagStore.setState({ integratedWorkspaceV1: true });
    useCenterTabStore.getState().setFrontComponentType(null);
  });

  describe('layouts apply to the current tab in place', () => {
    it('changes the current tab and never adds or switches tabs', async () => {
      const id = await store().createWorkspace('orthogonal-flexible');

      expect(setCurrentTabLayout('mosaic')).toBe('applied');
      expect(store().workspaces.get(id)?.type).toBe('mosaic');
      expect(setCurrentTabLayout('compare')).toBe('applied');
      expect(store().workspaces.size).toBe(1);
      expect(store().activeWorkspaceId).toBe(id);
    });

    it('changes this tab even when another tab already shows that layout', async () => {
      const compare = await store().createWorkspace('comparison');
      const current = await store().createWorkspace('orthogonal-flexible');

      setCurrentTabLayout('compare');

      expect(store().activeWorkspaceId).toBe(current);
      expect(store().workspaces.get(current)?.type).toBe('comparison');
      expect(store().workspaces.get(compare)?.type).toBe('comparison');
      expect(store().workspaces.size).toBe(2);
    });

    it('Orthogonal keeps the current orthogonal variant; Orthogonal panels picks the flexible one', async () => {
      const id = await store().createWorkspace('orthogonal-flexible');
      expect(setCurrentTabLayout('orthogonal')).toBe('unchanged');
      expect(store().workspaces.get(id)?.type).toBe('orthogonal-flexible');

      // Panels, ⌘3, ⌘1: back to Panels, the tab's last variant (QA 2026-10-30 F13).
      setCurrentTabLayout('mosaic');
      setCurrentTabLayout('orthogonal');
      expect(store().workspaces.get(id)?.type).toBe('orthogonal-flexible');

      // The locked grid is remembered the same way.
      expect(setCurrentTabLayout('orthogonal-locked')).toBe('applied');
      setCurrentTabLayout('compare');
      setCurrentTabLayout('orthogonal');
      expect(store().workspaces.get(id)?.type).toBe('orthogonal-locked');

      expect(setCurrentTabLayout('orthogonal-flexible')).toBe('applied');
      expect(store().workspaces.get(id)?.type).toBe('orthogonal-flexible');
    });

    it('a tab that was never orthogonal opens the locked grid, whatever other tabs use', async () => {
      const panels = await store().createWorkspace('orthogonal-flexible');
      const id = await store().createWorkspace('mosaic');
      setCurrentTabLayout('orthogonal');
      expect(store().workspaces.get(id)?.type).toBe('orthogonal-locked');
      expect(store().workspaces.get(panels)?.type).toBe('orthogonal-flexible');
    });

    it("one tab's layout change never renames another tab (QA 2026-10-30 F27)", async () => {
      const older = await store().createWorkspace('mosaic');
      const orthogonal = await store().createWorkspace('orthogonal-locked');
      const label = (id: string) => store().workspaces.get(id)?.tabLabel;
      expect(label(older)).toBe('Mosaic');
      expect(label(orthogonal)).toBe('Orthogonal');

      // The older tab joins Orthogonal: it takes the number, the other keeps its name.
      store().activateWorkspace(older);
      setCurrentTabLayout('orthogonal');
      expect(label(orthogonal)).toBe('Orthogonal');
      expect(label(older)).toBe('Orthogonal 2');

      // And switching it away leaves the other tab alone too.
      setCurrentTabLayout('compare');
      expect(label(older)).toBe('Compare');
      expect(label(orthogonal)).toBe('Orthogonal');

      // A tab keeps its number when the tab it was numbered against closes.
      store().activateWorkspace(orthogonal);
      const third = await store().createWorkspace('orthogonal-locked');
      expect(label(third)).toBe('Orthogonal 2');
      store().closeWorkspace(orthogonal);
      store().activateWorkspace(older);
      setCurrentTabLayout('mosaic');
      expect(label(third)).toBe('Orthogonal 2');
    });

    it('does nothing in a tool tab or while the surface tab is in front', async () => {
      const view = await store().createWorkspace('mosaic');
      const tool = await store().createWorkspace('bids-explorer');

      expect(setCurrentTabLayout('compare')).toBe('unavailable');
      expect(store().activeWorkspaceId).toBe(tool);
      expect(types()).toEqual(['mosaic', 'bids-explorer']);

      store().activateWorkspace(view);
      useCenterTabStore.getState().setFrontComponentType('surfaceView');
      expect(setCurrentTabLayout('compare')).toBe('unavailable');
      expect(store().workspaces.get(view)?.type).toBe('mosaic');
      // A surface placeholder from the last session too (QA 2026-10-31).
      useCenterTabStore.getState().setFrontComponentType('surfacePlaceholder');
      expect(setCurrentTabLayout('compare')).toBe('unavailable');
      expect(store().workspaces.get(view)?.type).toBe('mosaic');
    });

    it('does nothing for Integrated while its feature flag is off', async () => {
      const id = await store().createWorkspace('mosaic');
      useFeatureFlagStore.setState({ integratedWorkspaceV1: false });
      expect(setCurrentTabLayout('integrated')).toBe('unavailable');
      expect(store().workspaces.get(id)?.type).toBe('mosaic');
    });

    // QA 2026-10-31 N4: the app's default view is marked until the user
    // makes it theirs (a layout change); a view the user asked for is not.
    it('marks the default view as the app\'s own until its layout changes', async () => {
      const id = (await ensureDefaultView())!;
      expect(store().workspaces.get(id)?.defaultView).toBe(true);
      setCurrentTabLayout('mosaic');
      expect(store().workspaces.get(id)?.defaultView).toBeUndefined();
      const asked = await openNewView();
      expect(store().workspaces.get(asked)?.defaultView).toBeUndefined();
    });

    it('creates the first view only when no tab is open at all', async () => {
      expect(setCurrentTabLayout('mosaic')).toBe('created');
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(types()).toEqual(['mosaic']);
    });
  });

  describe('tabs come from New view, Open in new tab and tools', () => {
    it('New view opens a tab in the current layout', async () => {
      await store().createWorkspace('mosaic');
      const id = await openNewView();
      expect(store().activeWorkspaceId).toBe(id);
      expect(types()).toEqual(['mosaic', 'mosaic']);
    });

    it('New view from a tool opens the default layout', async () => {
      await openTool('set-studio');
      await openNewView();
      expect(types()).toEqual(['set-studio', DEFAULT_VIEW_TYPE]);
    });

    it('a tool opens once; opening it again focuses its tab', async () => {
      const first = await openTool('analysis-workbench');
      await openNewView();
      const again = await openTool('analysis-workbench');
      expect(again).toBe(first);
      expect(store().activeWorkspaceId).toBe(first);
      expect(types().filter((t) => t === 'analysis-workbench')).toHaveLength(1);
    });

    it('a workspace-type request opens a tool, or sets the layout of a view', async () => {
      const view = await store().createWorkspace('orthogonal-flexible');
      goToWorkspaceType('mosaic');
      expect(store().workspaces.get(view)?.type).toBe('mosaic');
      expect(store().workspaces.size).toBe(1);

      goToWorkspaceType('bids-explorer');
      await new Promise((r) => setTimeout(r, 0));
      expect(types()).toEqual(['mosaic', 'bids-explorer']);
    });
  });

  describe('launch never makes two tabs', () => {
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('a startup layout after the default view started applies to that one view', async () => {
      const pending = ensureDefaultView();
      expect(setCurrentTabLayout('mosaic')).toBe('pending');
      await pending;
      await settle();
      expect(types()).toEqual(['mosaic']);
    });

    it('the default view after a startup layout started is skipped', async () => {
      expect(setCurrentTabLayout('compare')).toBe('created');
      const second = ensureDefaultView();
      await second;
      await settle();
      expect(types()).toEqual(['comparison']);
    });

    it('a startup tool is the only tab (no default view beside it)', async () => {
      const tool = openTool('bids-explorer');
      expect(ensureDefaultView()).toBeNull();
      await tool;
      expect(types()).toEqual(['bids-explorer']);
    });

    it('no default view once a tab exists', async () => {
      await store().createWorkspace('mosaic');
      expect(ensureDefaultView()).toBeNull();
    });
  });

  it('detects an open modal dialog', () => {
    expect(isModalDialogOpen()).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    expect(isModalDialogOpen()).toBe(true);
    dialog.remove();
  });
});
