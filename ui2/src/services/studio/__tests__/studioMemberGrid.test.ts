import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCoordinationService } from '../StudioCoordinationService';
import { readMemberGridHeader } from '../studioMemberGrid';
import {
  activeStudioBackground,
  selectStudioBackgroundNote,
  selectStudioBackgroundPath,
  studioGridEvidence,
} from '../studioBackground';
import { useLayerStore } from '@/stores/layerStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SpatialFieldSetSummary } from '@/types/studio';

/**
 * The header-to-background path with nothing of it replaced: the command's
 * answer, as recorded, goes through the real `readMemberGridHeader` and the
 * real evidence and resolver. Only the IPC call and the display service (GPU
 * work) are stood in for.
 */
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  ensureMemberDisplayed: vi.fn(),
  syncBackground: vi.fn(),
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    getNiftiHeaderInfo: (volumeId: string) => mocks.invoke('get_nifti_header_info', { volumeId }),
  }),
}));
vi.mock('../StudioCompareService', () => ({
  getStudioCompareService: () => ({ materializeComparePanes: vi.fn() }),
}));
vi.mock('../StudioDisplayService', () => ({
  getStudioDisplayService: () => ({
    ensureMemberDisplayed: mocks.ensureMemberDisplayed,
    syncBackground: mocks.syncBackground,
    retryBackground: vi.fn(),
  }),
}));
vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({ emit: vi.fn(), on: vi.fn(() => () => {}), off: vi.fn() }),
}));

const SOURCE = '/cache/mount-a/pcmri/derivatives/enc_rep_rsa/sub-1006/enc_rep/maps/same_item.nii.gz';

/**
 * `get_nifti_header_info` for the owner's map, as the backend serialises a
 * `NiftiHeaderInfo`: three spatial `dimensions`, `voxel_spacing`, a row-major
 * `voxel_to_world` of sixteen numbers, and scanner xform codes (1/1), which
 * name no template space.
 */
const RECORDED_HEADER = {
  filename: 'same_item.nii.gz',
  dimensions: [91, 109, 91],
  voxel_spacing: [2, 2, 2],
  data_type: 'f32',
  voxel_to_world: [2, 0, 0, -90.5, 0, 2, 0, -126.5, 0, 0, 2, -72.5, 0, 0, 0, 1],
  world_bounds_min: [-91.5, -127.5, -73.5],
  world_bounds_max: [90.5, 90.5, 108.5],
  sform_code: 1,
  qform_code: 1,
  orientation_string: 'RAS',
  spatial_units: 'mm',
  temporal_units: null,
  tr_seconds: null,
  num_timepoints: null,
  description: '',
  data_range: null,
};

const NLIN6 = 'template:MNI152NLin6Asym_T1w_1mm';

function showLoadedMember() {
  useLayerStore.setState({
    layers: [{ id: 'layer-1', volumeId: 'volume-1', sourcePath: SOURCE }] as never,
    layerMetadata: new Map(),
  });
  useViewStateStore.setState((state) => ({
    viewState: { ...state.viewState, layers: [{ id: 'layer-1' }] as never },
  }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('member grid header, from the recorded command payload', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(structuredClone(RECORDED_HEADER));
    mocks.ensureMemberDisplayed.mockReset();
    mocks.ensureMemberDisplayed.mockResolvedValue(undefined);
    mocks.syncBackground.mockReset();
    mocks.syncBackground.mockImplementation(async (sourcePath: string | null) => ({
      status: sourcePath ? 'ready' : 'none',
      sourcePath,
    }));
    showLoadedMember();
  });
  afterEach(() => {
    useLayerStore.setState({ layers: [], layerMetadata: new Map() });
  });

  it('reads the payload into the header the lattice match takes', async () => {
    const header = await readMemberGridHeader(SOURCE);
    expect(mocks.invoke).toHaveBeenCalledWith('get_nifti_header_info', { volumeId: 'volume-1' });
    expect(header).toEqual({
      dims: [91, 109, 91],
      voxelToWorld: [2, 0, 0, -90.5, 0, 2, 0, -126.5, 0, 0, 2, -72.5, 0, 0, 0, 1],
      sformCode: 1,
      qformCode: 1,
    });
    expect(studioGridEvidence('folder', 'sub-1006', header!)).toEqual({
      setId: 'folder',
      memberId: 'sub-1006',
      dims: [91, 109, 91],
      voxelMm: [2, 2, 2],
      space: 'MNI152NLin6Asym',
      headerSpace: null,
    });
    // A path no layer in the view was loaded from gives nothing, and asks nothing.
    mocks.invoke.mockClear();
    expect(await readMemberGridHeader('/elsewhere/other.nii.gz')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('fills in the NLin6Asym template for the owner\'s set, through the coordinator', async () => {
    const members = [{ id: 'sub-1006', sourcePath: SOURCE }];
    useSetStudioStore.getState().bootstrapStudio({
      set: {
        id: 'folder',
        name: 'enc_rep_rsa',
        sourceKind: 'imported',
        memberCount: 1,
        primaryFeatureId: 'map',
        supportKind: 'volume',
        supportLabel: 'headers not sampled',
        alignmentClass: 'unknown',
        designColumns: [],
        designTablePreview: null,
        memberSummaries: members,
        memberIds: ['sub-1006'],
        savedCohortIds: [],
      } as unknown as SpatialFieldSetSummary,
      features: [{ id: 'map', label: 'Map', kind: 'volume' }] as never,
      cohorts: [],
      expressions: [],
      selection: { activeLens: 'deck', activeMemberId: 'sub-1006', compareCohortId: null },
    });
    const service = new StudioCoordinationService();
    service.start();
    try {
      await settle();
      const state = useSetStudioStore.getState();
      expect(state.studioGridEvidence).toEqual({
        setId: 'folder',
        memberId: 'sub-1006',
        dims: [91, 109, 91],
        voxelMm: [2, 2, 2],
        space: 'MNI152NLin6Asym',
        headerSpace: null,
      });
      expect(selectStudioBackgroundPath(state)).toBe(NLIN6);
      expect(activeStudioBackground(state).origin).toBe('grid');
      expect(mocks.syncBackground.mock.calls.at(-1)?.[0]).toBe(NLIN6);
      // The note says what the grid establishes, and no more.
      expect(selectStudioBackgroundNote(state)).toBe(
        "MNI152 grid matched from this image (91 × 109 × 91, 2 mm); the other images were not checked.",
      );
    } finally {
      service.stop();
    }
  });
});
