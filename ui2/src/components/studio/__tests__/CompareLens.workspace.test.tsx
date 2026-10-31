import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('../StudioRenderAdapter', () => ({ StudioRenderAdapter: () => <div data-testid="pane-a" /> }));
vi.mock('../StudioDerivedPaneCanvas', () => ({ StudioDerivedPaneCanvas: () => null }));

import { CompareLens } from '../CompareLens';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 300, height: 200 } } as ResizeObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
}

const layer = (colormap: string) => ({
  id: 'member',
  name: 'member',
  volumeId: 'member',
  visible: true,
  opacity: 1,
  colormap,
  intensity: [0, 2] as [number, number],
  threshold: [0, 0] as [number, number],
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  useLayerStore.setState({
    layers: [{ id: 'member', name: 'member', volumeId: 'member', visible: true, order: 0, sourcePath: '/m/s01.nii' }],
  } as never);
  useWorkspaceStore.setState({
    workspaces: new Map([['studio-ws', { id: 'studio-ws', type: 'set-studio' } as never]]),
  } as never);
  // The tab in front shows the layer grey; the Studio's own workspace, hot.
  const state = useViewStateStore.getState();
  act(() =>
    useViewStateStore.setState({
      viewState: { ...state.viewState, layers: [layer('gray')] as never },
      workspaceViewStates: new Map([
        ...state.workspaceViewStates,
        ['studio-ws', { ...state.viewState, layers: [layer('hot')] as never }],
      ]),
    } as never),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("pane A's colourbar shows the Studio workspace's display, not the tab in front (review L4)", () => {
  render(
    <CompareLens
      activeSet={{ supportKind: 'volume', supportLabel: 'MNI152NLin2009cAsym (2mm)' } as never}
      activeFeature={null}
      activeArtifact={null}
      activeMemberId="s01"
      activeMember={{ id: 's01', sourcePath: '/m/s01.nii' } as never}
      compareCohort={null}
      cohorts={[]}
      activeExpression={null}
      paneSpecs={[]}
      loading={false}
      refreshingPaneIds={[]}
      onSelectCohort={vi.fn()}
      onDrillToCohort={vi.fn()}
      onOpenPane={vi.fn()}
      onInspectPane={vi.fn()}
      onInspectCurrent={vi.fn()}
      onOpenCurrentSource={vi.fn()}
      onOpenCompareView={vi.fn()}
      onRecomputePane={vi.fn()}
    />,
  );
  expect(screen.getByTestId('studio-scale-bar').dataset.colormap).toBe('hot');
});
