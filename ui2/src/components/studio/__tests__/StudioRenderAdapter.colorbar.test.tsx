/**
 * Studio Compare pane A's colourbar describes the member it renders (QA N16
 * review W3): the adapter resolves the member's layer from its source and
 * hands it to the shared slice view through the colorbar group.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOverlayColorbar } from '@/components/views/viewportFrame/useOverlayColorbar';
import { useColorbarGroup } from '@/components/views/viewportFrame/viewportFrameStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

// The slice view: a probe reading the same hooks SliceViewCanvas uses.
vi.mock('@/components/views/FlexibleSlicePanel', () => ({
  FlexibleSlicePanel: ({ viewId }: { viewId: string }) => {
    const bar = useOverlayColorbar();
    const { group } = useColorbarGroup();
    return <div data-testid={`probe-${viewId}`} data-layer={bar?.layerId ?? ''} data-group={group} />;
  },
}));
vi.mock('@/components/views/OrthogonalViewContainer', () => ({ OrthogonalViewContainer: () => null }));
vi.mock('@/components/views/SurfaceViewPanelLazy', () => ({ SurfaceViewPanel: () => null }));
vi.mock('@/hooks/useStudioMemberRenderScope', () => ({ useStudioMemberRenderScope: () => {} }));

import { StudioRenderAdapter } from '../StudioRenderAdapter';

const viewLayer = (id: string) => ({
  id,
  name: id,
  volumeId: id,
  visible: true,
  opacity: 1,
  colormap: 'gray',
  intensity: [0, 1] as [number, number],
  threshold: [0, 0] as [number, number],
});

beforeEach(() => {
  // Anatomy, the member, and an unrelated overlay that is selected.
  useLayerStore.setState({
    layers: [
      { id: 'anat', name: 'anat', volumeId: 'anat', visible: true, order: 0, sourcePath: '/t/mni.nii' },
      { id: 'member', name: 'member', volumeId: 'member', visible: true, order: 1, sourcePath: '/m/s01.nii' },
      { id: 'other', name: 'other', volumeId: 'other', visible: true, order: 2, sourcePath: '/m/other.nii' },
    ],
    selectedLayerId: 'other',
  } as never);
  const state = useViewStateStore.getState();
  act(() =>
    useViewStateStore.setState({
      viewState: { ...state.viewState, layers: [viewLayer('anat'), viewLayer('member'), viewLayer('other')] as never },
    } as never),
  );
});
afterEach(cleanup);

it('pane A (describeBase) describes the member, not the selected overlay, in a group of its own', () => {
  render(<StudioRenderAdapter supportKind="volume" title="" subtitle="" hideChrome plane="coronal" memberSourcePath="/m/s01.nii" describeBase />);
  const probe = screen.getByTestId('probe-coronal');
  expect(probe.dataset.layer).toBe('member');
  expect(probe.dataset.group).not.toBe('main');
});

it('the Deck (no describeBase) keeps the usual rule, still apart from the main views', () => {
  render(<StudioRenderAdapter supportKind="volume" title="" subtitle="" hideChrome plane="axial" memberSourcePath="/m/s01.nii" />);
  const probe = screen.getByTestId('probe-axial');
  expect(probe.dataset.layer).toBe('other');
  expect(probe.dataset.group).not.toBe('main');
});
