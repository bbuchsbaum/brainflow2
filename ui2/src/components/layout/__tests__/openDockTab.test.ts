import { beforeEach, describe, expect, it } from 'vitest';
import { dockTabForPanel, openDockTab } from '../openDockTab';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';

describe('View › Panels dock routing', () => {
  beforeEach(() => {
    useLayoutSettingsStore.getState().setBottomDockOpen(false);
    useLayoutSettingsStore.getState().setBottomDockMinimized(true);
  });

  it('routes Plot Panel and Clusters to their dock tabs, nothing else', () => {
    expect(dockTabForPanel('PlotPanel')).toBe('plot');
    expect(dockTabForPanel('ClusterPanel')).toBe('clusters');
    expect(dockTabForPanel('FileBrowser')).toBeNull();
    expect(dockTabForPanel('LayerPanel')).toBeNull();
  });

  it('reopens a closed, minimized dock on the plot tab', () => {
    openDockTab(dockTabForPanel('PlotPanel')!);
    const state = useLayoutSettingsStore.getState();
    expect(state.isBottomDockOpen()).toBe(true);
    expect(state.bottomDockMinimized).toBe(false);
    expect(state.bottomDockActiveTab).toBe('plot');
  });
});
