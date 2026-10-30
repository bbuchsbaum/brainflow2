import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { SpatialFieldSetSummary } from '@/types/studio';
import type { ViewState } from '@/types/viewState';
import type { LayerInfo } from '@/stores/layerStore';
import { useLayerStore } from '@/stores/layerStore';
import { useAppModeStore } from '@/stores/appModeStore';
import {
  applyRenderLayerScope,
  hasRenderLayerScope,
  resetRenderLayerScope,
} from '@/services/render/RenderLayerScope';
import { DeckLens } from '../DeckLens';

vi.mock('@/components/views/OrthogonalViewContainer', () => ({
  OrthogonalViewContainer: () => <div data-testid="ortho" />,
}));
vi.mock('@/components/views/SurfaceViewPanelLazy', () => ({
  SurfaceViewPanel: () => <div data-testid="surface" />,
}));

const MEMBER_PATH = '/data/fir3d/sub-01_faces_beta.nii.gz';

const volumeSet = {
  id: 'fir3d',
  supportKind: 'volume',
  supportLabel: 'MNI 4 mm',
  memberIds: ['s01_faces_l2', 's02_faces_l2'],
  memberSummaries: [],
} as unknown as SpatialFieldSetSummary;

function layer(id: string, sourcePath: string): LayerInfo {
  return { id, name: id, volumeId: `vol-${id}`, sourcePath, visible: true } as unknown as LayerInfo;
}

/** The workspace scene the Deck must not draw: T1 + ASEG + Olsen. */
function seedWorkspace(extra: LayerInfo[] = []): void {
  useLayerStore.setState({
    layers: [
      layer('t1', '/data/mni_t1.nii.gz'),
      layer('aseg', '/data/aseg.nii.gz'),
      layer('olsen', '/data/olsen.nii.gz'),
      ...extra,
    ],
    layerMetadata: new Map(),
  });
}

function sceneViewState(): ViewState {
  return {
    layers: useLayerStore.getState().layers.map((l) => ({ id: l.id, volumeId: l.volumeId })),
  } as unknown as ViewState;
}

const drawnLayerIds = () => applyRenderLayerScope(sceneViewState()).layers.map((l) => l.id);

function renderDeck(sourcePath: string | null) {
  return render(
    <DeckLens
      activeSet={volumeSet}
      activeFeature={null}
      activeMemberId="s01_faces_l2"
      activeMemberSourcePath={sourcePath}
      onSelectMember={vi.fn()}
      onInspectCurrent={vi.fn()}
      onOpenCurrentSource={vi.fn()}
    />,
  );
}

describe('DeckLens render scope', () => {
  beforeEach(() => {
    resetRenderLayerScope();
    useAppModeStore.setState({ mode: 'studio' });
    seedWorkspace();
  });
  afterEach(cleanup);

  it("draws only the member's layer, never the workspace scene", () => {
    seedWorkspace([layer('member', MEMBER_PATH)]);
    renderDeck(MEMBER_PATH);
    expect(drawnLayerIds()).toEqual(['member']);
  });

  it('draws nothing until the member loads, then the member alone', () => {
    renderDeck(MEMBER_PATH);
    expect(drawnLayerIds()).toEqual([]);

    act(() => {
      seedWorkspace([layer('member', MEMBER_PATH)]);
    });
    expect(drawnLayerIds()).toEqual(['member']);
  });

  it('hands the views back to the workspace when the Deck closes', () => {
    seedWorkspace([layer('member', MEMBER_PATH)]);
    const view = renderDeck(MEMBER_PATH);
    view.unmount();
    expect(hasRenderLayerScope()).toBe(false);
    expect(drawnLayerIds()).toEqual(['t1', 'aseg', 'olsen', 'member']);
  });

  it('does not add or change workspace layers', () => {
    const before = useLayerStore.getState().layers;
    renderDeck(MEMBER_PATH);
    expect(useLayerStore.getState().layers).toBe(before);
  });

  it('hands the views back when another workspace tab is active, Deck still mounted', () => {
    seedWorkspace([layer('member', MEMBER_PATH)]);
    renderDeck(MEMBER_PATH);
    expect(drawnLayerIds()).toEqual(['member']);
    act(() => useAppModeStore.setState({ mode: 'imaging' }));
    expect(hasRenderLayerScope()).toBe(false);
    act(() => useAppModeStore.setState({ mode: 'studio' }));
    expect(drawnLayerIds()).toEqual(['member']);
  });
});
