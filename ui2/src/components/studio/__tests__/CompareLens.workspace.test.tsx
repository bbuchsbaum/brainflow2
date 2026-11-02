import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('../StudioRenderAdapter', () => ({
  StudioRenderAdapter: ({ plane, describeBase }: { plane?: string; describeBase?: boolean }) => (
    <div data-testid="pane-a" data-plane={plane} data-describe-base={describeBase ? 'true' : undefined} />
  ),
}));
vi.mock('../StudioDerivedPaneCanvas', () => ({
  StudioDerivedPaneCanvas: ({ paneId, plane }: { paneId: string; plane?: string }) => (
    <div data-testid={`derived-${paneId}`} data-plane={plane} />
  ),
}));

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

const lens = (paneSpecs: unknown[] = []) => (
  <CompareLens
    activeSet={{ supportKind: 'volume', supportLabel: 'MNI152NLin2009cAsym (2mm)' } as never}
    activeFeature={null}
    activeArtifact={null}
    activeMemberId="s01"
    activeMember={{ id: 's01', sourcePath: '/m/s01.nii' } as never}
    compareCohort={null}
    cohorts={[]}
    activeExpression={null}
    paneSpecs={paneSpecs as never}
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
  />
);

it('all four panes show one plane, the session plane shared with the Deck (QA N13 c)', async () => {
  const { useSetStudioStore } = await import('@/stores/setStudioStore');
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  act(() => useSetStudioStore.getState().setStudioPlane('sagittal'));
  const ready = (id: string) => ({
    id,
    title: id,
    status: 'ready',
    binding: { kind: 'derived_field', ready: true, cacheStatus: 'hit', sourcePath: `/c/${id}.nii.gz` },
  });
  render(lens([ready('cohort-mean'), ready('residual'), ready('zscore')]));
  expect(screen.getByTestId('pane-a').dataset.plane).toBe('sagittal');
  for (const id of ['cohort-mean', 'residual', 'zscore'])
    expect(screen.getByTestId(`derived-${id}`).dataset.plane).toBe('sagittal');
  // The toggle (in place without a toolbar slot) drives every pane.
  act(() => {
    screen.getByRole('radio', { name: 'Axial' }).click();
  });
  expect(screen.getByTestId('pane-a').dataset.plane).toBe('axial');
  expect(screen.getByTestId('derived-zscore').dataset.plane).toBe('axial');
});

it('pane A has exactly one colourbar: the shared view describes the member, no second bar (QA N16)', () => {
  // The shared view draws the bar from the workspace in front, which is the
  // Studio's whenever the Studio shows (useStudioInFront), so review L4 holds.
  render(lens());
  expect(screen.getByTestId('pane-a').dataset.describeBase).toBe('true');
  expect(screen.queryByTestId('studio-scale-bar')).toBeNull();
});
