import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewStateStore } from '../viewStateStore';
import { useCrosshairSettingsStore, DEFAULT_SETTINGS } from '../crosshairSettingsStore';
import { coalesceUtils } from '../middleware/coalesceUpdatesMiddleware';
import { setVoxelGridReferenceProvider, type VoxelGridReference } from '@/utils/voxelSnap';

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    recalculateAllViews: vi.fn(),
    recalculateViewForDimensions: vi.fn(),
    getVolumeBounds: vi.fn(),
    initRenderLoop: vi.fn(),
  }),
}));

// 2 mm MNI grid (column-major), voxel centres at odd half-mm.
const MNI: VoxelGridReference = {
  layerId: 't1',
  name: 'T1',
  voxelToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -95.5, -131.5, -77.5, 1],
  worldToVoxel: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 47.75, 65.75, 38.75, 1],
  dims: [96, 114, 96],
};

describe('setCrosshair voxel snapping (crosshairSettings.snapToVoxel)', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    coalesceUtils.clearPending();
    coalesceUtils.setBackendCallback(vi.fn());
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    setVoxelGridReferenceProvider(() => MNI);
  });

  afterEach(() => setVoxelGridReferenceProvider(null));

  it('is on by default and lands on the nearest voxel centre of the reference grid', async () => {
    expect(useCrosshairSettingsStore.getState().settings.snapToVoxel).toBe(true);
    await useViewStateStore.getState().setCrosshair([-40, -20, 50], true);
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([-39.5, -19.5, 50.5]);
  });

  it('aligns the slice planes to the snapped position, not the requested one', async () => {
    await useViewStateStore.getState().setCrosshair([42, -60, -10], true);
    const { views } = useViewStateStore.getState().viewState;
    // Axial plane normal is z: its origin's z is the snapped crosshair z.
    expect(views.axial.origin_mm[2]).toBeCloseTo(-9.5, 6);
  });

  it('leaves the position untouched when snapping is off', async () => {
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, snapToVoxel: false } });
    await useViewStateStore.getState().setCrosshair([-40, -20, 50], true);
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([-40, -20, 50]);
  });

  it('leaves the position untouched without a volume reference', async () => {
    setVoxelGridReferenceProvider(() => null);
    await useViewStateStore.getState().setCrosshair([1.2, 3.4, 5.6]);
    expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([1.2, 3.4, 5.6]);
  });
});
