import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterTable } from '@brainflow/api';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
vi.mock('../atlasRegionLookup', () => ({
  resolveAtlasRegionAtWorld: vi.fn(async (world: number[]) =>
    world[0] < 0 ? { entry: { label_id: 1, roi: 'L_sensorimotor', displayName: 'L_sensorimotor', color: [0, 0, 0] } } : null,
  ),
  formatRegionLabel: (e: { displayName?: string; roi: string }) => e.displayName ?? e.roi,
}));

import {
  ClusterService,
  clusterMethodsSentence,
  clusterTableCsv,
} from '../ClusterService';
import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { BackendTransport } from '../transport';

const cluster = (id: number, sign: 'positive' | 'negative', peak: number, mm: [number, number, number], n: number) => ({
  id,
  sign,
  voxelCount: n,
  volumeMm3: n * 8,
  peakValue: peak,
  peakIjk: [1, 2, 3] as [number, number, number],
  peakMm: mm,
  meanValue: peak / 2,
  centroidIjk: [1, 2, 3] as [number, number, number],
  centroidMm: [mm[0] - 0.4, mm[1], mm[2]] as [number, number, number],
  weightedCentroidMm: mm,
  bboxIjkMin: [0, 0, 0] as [number, number, number],
  bboxIjkMax: [2, 2, 2] as [number, number, number],
  bboxMmMin: mm,
  bboxMmMax: mm,
});

const TABLE: ClusterTable = {
  clusters: [cluster(1, 'positive', 5.965, [-39.5, -19.5, 50.5], 398), cluster(2, 'negative', -4.977, [0.5, 40.5, 10.5], 359)],
  threshold: Math.fround(3.1),
  sign: 'both',
  connectivity: 26,
  minVoxels: 1,
  timepoint: null,
  voxelVolumeMm3: 8,
  suprathresholdVoxels: 757,
  totalClusters: 2,
  discardedClusters: 0,
  truncated: false,
};

function transport(reply: unknown) {
  return { invoke: vi.fn(async () => reply) } as unknown as BackendTransport & { invoke: ReturnType<typeof vi.fn> };
}

describe('ClusterService', () => {
  beforeEach(() => {
    useClusterStore.getState().reset();
    useLayerStore.setState({
      layers: [{ id: 'z', name: 'zmap_synthetic.nii.gz', volumeId: 'vol-z', type: 'volume', visible: true, order: 0 } as never],
    });
  });

  it('calls compute_clusters with the request and publishes the table with peak regions', async () => {
    const t = transport(TABLE);
    await new ClusterService(t).compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    expect(t.invoke).toHaveBeenCalledWith('compute_clusters', {
      request: { layerId: 'z', volumeId: 'vol-z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 },
    });
    const state = useClusterStore.getState();
    expect(state.status).toBe('ready');
    expect(state.result?.regions).toEqual(['L_sensorimotor', null]);
    expect(state.result?.layerName).toBe('zmap_synthetic.nii.gz');
  });

  it('reports a backend string rejection as the error text', async () => {
    const t = { invoke: vi.fn(async () => Promise.reject('Connectivity must be 6, 18 or 26 (got 7)')) } as unknown as BackendTransport;
    await new ClusterService(t).compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    expect(useClusterStore.getState().status).toBe('error');
    expect(useClusterStore.getState().error).toContain('Connectivity must be 6, 18 or 26');
  });

  it('selecting a row moves the crosshair to its peak', async () => {
    const t = transport(TABLE);
    const service = new ClusterService(t);
    await service.compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    const setCrosshair = vi.spyOn(useViewStateStore.getState(), 'setCrosshair').mockResolvedValue();
    await service.selectCluster(2);
    expect(useClusterStore.getState().selectedId).toBe(2);
    // Exactly on the peak voxel: not snapped to a coarser reference (review R2).
    expect(setCrosshair).toHaveBeenCalledWith([0.5, 40.5, 10.5], true, false, undefined, { snap: false });
    setCrosshair.mockRestore();
  });

  it('goes to the max through volume_extremum', async () => {
    const t = transport({ value: 5.965, ijk: [28, 56, 64], worldMm: [-39.5, -19.5, 50.5], timepoint: null });
    const setCrosshair = vi.spyOn(useViewStateStore.getState(), 'setCrosshair').mockResolvedValue();
    await new ClusterService(t).goToExtremum('z', 'max');
    expect(t.invoke).toHaveBeenCalledWith('volume_extremum', { request: { layerId: 'z', volumeId: 'vol-z', kind: 'max' } });
    expect(setCrosshair).toHaveBeenCalledWith([-39.5, -19.5, 50.5], true, false, undefined, { snap: false });
    setCrosshair.mockRestore();
  });
});

describe('cluster methods sentence and CSV', () => {
  it('states the parameters and totals', () => {
    expect(clusterMethodsSentence(TABLE, 'z')).toBe(
      '26-connected clusters of |z| > 3.1, two-sided, uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels',
    );
    expect(clusterMethodsSentence({ ...TABLE, discardedClusters: 3, minVoxels: 5 }, 't(24)')).toBe(
      '26-connected clusters of |t| > 3.1 (t(24)), two-sided, uncorrected, ≥ 5 voxels; 2 clusters, 757 voxels (3 smaller dropped)',
    );
    expect(clusterMethodsSentence({ ...TABLE, sign: 'negative' }, 'z')).toBe(
      '26-connected clusters of z < \u22123.1, one-sided (negative), uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels',
    );
  });

  it('leaves the weighted COG empty when the backend did not send it (v3 fidelity)', () => {
    const noCog = { ...TABLE, clusters: [{ ...TABLE.clusters[0], weightedCentroidMm: undefined as never, centroidMm: [-39.913, -19.5, 50.5] as [number, number, number] }] };
    const row = clusterTableCsv(noCog, ['L_sensorimotor'], { layerName: 'zmap', symbol: 'z' }).split('\n')[2].split(',');
    const header = clusterTableCsv(noCog, [null], { layerName: 'zmap', symbol: 'z' }).split('\n')[1].split(',');
    const at = (name: string) => row[header.indexOf(name)];
    expect(at('centroid_x_mm')).toBe('-39.91');
    expect([at('cog_abs_weighted_x_mm'), at('cog_abs_weighted_y_mm'), at('cog_abs_weighted_z_mm')]).toEqual(['', '', '']);
  });

  it('writes an ASCII CSV with a parameter comment line', () => {
    const csv = clusterTableCsv(TABLE, ['L_sensorimotor', null], { layerName: 'zmap', symbol: 'z' }).split('\n');
    expect(csv[0]).toBe('# zmap: 26-connected clusters of |z| > 3.1, two-sided, uncorrected, >= 1 voxel; 2 clusters, 757 voxels');
    expect(csv[1].split(',')[0]).toBe('cluster');
    expect(csv[1]).toContain('centroid_x_mm,centroid_y_mm,centroid_z_mm,cog_abs_weighted_x_mm');
    expect(csv[1].endsWith('region_at_peak')).toBe(true);
    expect(csv[2]).toBe('1,positive,398,3184,5.965,-39.5,-19.5,50.5,1,2,3,-39.9,-19.5,50.5,-39.5,-19.5,50.5,2.9825,L_sensorimotor');
    expect(csv[3].startsWith('2,negative,359,2872,-4.977,0.5,40.5,10.5')).toBe(true);
    expect(csv[3].endsWith(',')).toBe(true);
  });

  it('clears a table whose layer is removed, keeping the parameters (review R8)', async () => {
    const { clearResultForRemovedLayer } = await import('../ClusterService');
    const { useClusterStore } = await import('@/stores/clusterStore');
    useClusterStore.getState().setParams({ minVoxels: 7 });
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'z', table: { clusters: [] } as never, regions: [], computedAt: 0 });
    clearResultForRemovedLayer('other');
    expect(useClusterStore.getState().result).not.toBeNull();
    clearResultForRemovedLayer('z');
    expect(useClusterStore.getState().result).toBeNull();
    expect(useClusterStore.getState().params.minVoxels).toBe(7);
  });
});
