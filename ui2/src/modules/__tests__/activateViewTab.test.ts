/** Module entry points shown outside a view bring a view tab to the front. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useCenterTabStore } from '@/stores/centerTabStore';
import { initializeViewRegistry } from '@/services/ViewRegistry';
import { currentTabTakesLayout } from '@/services/workspaceNavigation';
import { activateViewTab } from '@/modules/api/host';

const store = () => useWorkspaceStore.getState();
let stopLayout: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  initializeViewRegistry();
  useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
  useFeatureFlagStore.setState({ integratedWorkspaceV1: true });
  useCenterTabStore.getState().setFrontComponentType(null);
});
afterEach(() => { stopLayout?.(); stopLayout = null; });
/** Stand-in for GoldenLayoutRoot: a front request brings the workspace tab forward a tick later. */
function layoutAnswersFrontRequests() {
  stopLayout = useCenterTabStore.subscribe((state, previous) => {
    if (state.workspaceFrontRequest !== previous.workspaceFrontRequest) setTimeout(() => useCenterTabStore.getState().setFrontComponentType('Workspace'), 5);
  });
}

describe('activateViewTab', () => {
  it('waits until the view behind a surface tab is actually in front', async () => {
    const view = await store().createWorkspace('orthogonal-flexible');
    useCenterTabStore.getState().setFrontComponentType('surfaceView');
    expect(currentTabTakesLayout()).toBe(false);
    layoutAnswersFrontRequests();
    const pending = activateViewTab();
    // Not yet: the centre stack has not reported its new front tab.
    expect(currentTabTakesLayout()).toBe(false);
    await expect(pending).resolves.toBe(true);
    expect(store().activeWorkspaceId).toBe(view);
    expect(currentTabTakesLayout()).toBe(true);
  });

  it('switches from a tool tab to a view tab', async () => {
    const view = await store().createWorkspace('orthogonal-flexible');
    const tool = await store().createWorkspace('bids-explorer');
    store().activateWorkspace(tool);
    useCenterTabStore.getState().setFrontComponentType('Workspace');
    await expect(activateViewTab()).resolves.toBe(true);
    expect(store().activeWorkspaceId).toBe(view);
  });

  it('resolves false when no view tab exists', async () => {
    await expect(activateViewTab()).resolves.toBe(false);
  });

  it('resolves false when the view never comes forward', async () => {
    await store().createWorkspace('orthogonal-flexible');
    useCenterTabStore.getState().setFrontComponentType('surfaceView');
    await expect(activateViewTab(20)).resolves.toBe(false);
  });
});
