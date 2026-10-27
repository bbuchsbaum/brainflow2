/**
 * Review D1: with snapping on, stepping moves exactly one REFERENCE voxel,
 * whatever grid the visible layer has (a 1 mm T1 over a 2 mm reference
 * used to ask for half a voxel, which the snap rounded back: stuck).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairSettingsStore, DEFAULT_SETTINGS } from '@/stores/crosshairSettingsStore';
import { useLayerStore } from '@/stores/layerStore';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { setVoxelGridReferenceProvider, type VoxelGridReference } from '@/utils/voxelSnap';
import { getSliceNavigationService, steppedSlicePosition } from '../SliceNavigationService';

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    recalculateAllViews: vi.fn(),
    recalculateViewForDimensions: vi.fn(),
    getVolumeBounds: vi.fn(),
    initRenderLoop: vi.fn(),
  }),
}));

/** An axis-aligned grid of `mm` voxels whose first centre is `origin`. */
function grid(id: string, mm: number, origin: [number, number, number], dims: [number, number, number]) {
  const reference: VoxelGridReference = {
    layerId: id,
    name: id,
    voxelToWorld: [mm, 0, 0, 0, 0, mm, 0, 0, 0, 0, mm, 0, origin[0], origin[1], origin[2], 1],
    worldToVoxel: [1 / mm, 0, 0, 0, 0, 1 / mm, 0, 0, 0, 0, 1 / mm, 0, -origin[0] / mm, -origin[1] / mm, -origin[2] / mm, 1],
    dims,
  };
  const metadata = {
    worldBounds: {
      min: origin,
      max: origin.map((o, a) => o + (dims[a] - 1) * mm) as [number, number, number],
    },
    dimensions: dims,
    spacing: [mm, mm, mm] as [number, number, number],
  };
  return { reference, metadata };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(refMm: number) {
  const ref = grid('ref', refMm, [-90.5, -126.5, -72.5], [Math.round(180 / refMm), Math.round(216 / refMm), Math.round(180 / refMm)]);
  const t1 = grid('t1', 1, [-90, -126, -72], [181, 217, 181]);
  // The reference (bottom) layer is hidden; the 1 mm T1 is the first visible.
  useLayerStore.setState({
    layers: [
      { id: 'ref', name: 'ref', volumeId: 'ref', type: 'volume', visible: false, order: 0 },
      { id: 't1', name: 't1', volumeId: 't1', type: 'volume', visible: true, order: 1 },
    ] as never,
    layerMetadata: new Map([
      ['ref', ref.metadata],
      ['t1', t1.metadata],
    ]) as never,
  });
  setVoxelGridReferenceProvider(() => ref.reference);
  return ref;
}

describe('slice stepping on the snapping reference grid (review D1)', () => {
  beforeEach(async () => {
    useViewStateStore.getState().resetToDefaults();
    coalesceUtils.clearPending();
    coalesceUtils.setBackendCallback(vi.fn());
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  });
  afterEach(() => setVoxelGridReferenceProvider(null));

  it.each([2, 3])('%i mm reference under a 1 mm T1: both directions move one reference voxel', async (mm) => {
    setup(mm);
    await useViewStateStore.getState().setCrosshair([0, 0, 10], true);
    const start = useViewStateStore.getState().viewState.crosshair.world_mm[2];
    const nav = getSliceNavigationService();
    expect(nav.getSliceRange('axial').step).toBeCloseTo(mm, 9);

    nav.stepSlice('axial', -1);
    await settle();
    const down = useViewStateStore.getState().viewState.crosshair.world_mm[2];
    expect(down).toBeCloseTo(start - mm, 6);

    nav.stepSlice('axial', 1);
    await settle();
    nav.stepSlice('axial', 1);
    await settle();
    expect(useViewStateStore.getState().viewState.crosshair.world_mm[2]).toBeCloseTo(start + mm, 6);
  });

  it('a step finer than the grid is extended until the snapped slice moves (Compare rail on a finer panel layer)', () => {
    const ref = setup(3);
    void ref;
    // Reference centres along z: ... 5.5, 8.5, 11.5 ...
    const range = { min: -72.5, max: 107.5, step: 1, current: 8.5 };
    expect(steppedSlicePosition(range, [0.5, 0.5, 8.5], 2, -1)).toBeCloseTo(5.5, 6);
    expect(steppedSlicePosition(range, [0.5, 0.5, 8.5], 2, 1)).toBeCloseTo(11.5, 6);
  });

  it('without snapping, the visible layer grid (1 mm) as before', () => {
    setup(2);
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, snapToVoxel: false } });
    expect(getSliceNavigationService().getSliceRange('axial').step).toBeCloseTo(1, 9);
  });
});
