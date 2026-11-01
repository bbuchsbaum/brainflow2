import { beforeEach, describe, expect, it, vi } from 'vitest';

const { compute } = vi.hoisted(() => ({ compute: vi.fn() }));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
vi.mock('@/services/ClusterService', async (orig) => ({
  ...(await orig<typeof import('@/services/ClusterService')>()),
  getClusterService: () => ({ compute }),
}));

import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useSeriesStore, DEFAULT_SERIES_SETTINGS } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  CLUSTER_AS_REGION_COMMAND,
  clusterRegionUnavailable,
  clusterRowCsv,
  openClusterAsRegion,
} from '../openClusterSeries';
import { rankCommands } from '@/components/dialogs/commandPaletteMatch';

const cluster = (id: number, peak: number) => ({
  id,
  sign: peak > 0 ? 'positive' : 'negative',
  voxelCount: 10,
  volumeMm3: 80,
  peakValue: peak,
  peakIjk: [1, 2, 3],
  peakMm: [-40, -20, 50],
  meanValue: peak / 2,
  centroidIjk: [1, 2, 3],
  centroidMm: [-40, -20, 50],
  weightedCentroidMm: [-40, -20, 50],
  bboxIjkMin: [0, 0, 0],
  bboxIjkMax: [0, 0, 0],
  bboxMmMin: [0, 0, 0],
  bboxMmMax: [0, 0, 0],
});

const table = (labelVolumeId?: string) =>
  ({
    clusters: [cluster(1, 6.4052), cluster(2, -4.75)],
    threshold: 3.93,
    negativeThreshold: 3.1,
    sign: 'both',
    connectivity: 26,
    minVoxels: 1,
    timepoint: null,
    voxelVolumeMm3: 8,
    suprathresholdVoxels: 20,
    totalClusters: 2,
    discardedClusters: 0,
    truncated: false,
    maxPeaksPerCluster: 3,
    minPeakDistanceMm: 8,
    extentInference: null,
    labelVolumeId,
  }) as never;

const publish = (labelVolumeId?: string) =>
  useClusterStore.getState().setResult({
    layerId: 'z',
    layerName: 'p4_zmap',
    table: table(labelVolumeId),
    regions: ['L_motor', null],
    computedAt: 0,
  });

describe('Use cluster as region (QA 2026-10-31 F5.4)', () => {
  beforeEach(() => {
    compute.mockReset();
    useSeriesStore.setState({ ...DEFAULT_SERIES_SETTINGS });
    useClusterStore.getState().reset();
    useLayerStore.setState({
      layers: [
        { id: 'z', name: 'p4_zmap', volumeId: 'z', type: 'volume', visible: true, order: 0 },
        { id: 'bold', name: 'bold', volumeId: 'bold', type: 'volume', visible: true, order: 1, timeSeriesInfo: { num_timepoints: 30 } },
      ],
      selectedLayerId: null,
    } as never);
    useSetStudioStore.setState({ sets: {}, selection: { ...useSetStudioStore.getState().selection, activeSetId: null } });
  });

  it('says why it cannot: no table, no row', async () => {
    await expect(openClusterAsRegion()).rejects.toThrow('Compute clusters first.');
    publish('labels-1');
    await expect(openClusterAsRegion()).rejects.toThrow('Select a cluster row.');
  });

  it('uses the row as the Series cluster region', async () => {
    publish('labels-1');
    await openClusterAsRegion(2);
    expect(compute).not.toHaveBeenCalled();
    expect(useClusterStore.getState().selectedId).toBe(2);
    expect(useSeriesStore.getState()).toMatchObject({ locus: 'cluster', source: 'layer' });
  });

  it('computes a table made on load again (it has no label volume), with the same tails', async () => {
    publish();
    compute.mockImplementation(async () => {
      publish('labels-2');
      return useClusterStore.getState().result!.table;
    });
    await openClusterAsRegion(1);
    expect(compute).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: 'z', threshold: 3.93, negativeThreshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 }),
    );
    expect(useClusterStore.getState().selectedId).toBe(1);
    expect(useSeriesStore.getState().locus).toBe('cluster');
  });

  it('reports a recompute that still has no label volume', async () => {
    publish();
    compute.mockImplementation(async () => {
      useClusterStore.getState().setError('backend gone');
      return null;
    });
    await expect(openClusterAsRegion(1)).rejects.toThrow('backend gone');
  });

  it('never selects a row of another table published during the recompute (review M1)', async () => {
    publish();
    compute.mockImplementation(async () => {
      publish('labels-2');
      const own = useClusterStore.getState().result!.table;
      // Another layer's Compute lands meanwhile.
      useClusterStore.getState().setResult({ layerId: 'other', layerName: 'other', table: table('labels-9'), regions: [], computedAt: 1 });
      return own;
    });
    await expect(openClusterAsRegion(1)).rejects.toThrow('The table changed.');
    expect(useClusterStore.getState().selectedId).toBeNull();
    expect(useSeriesStore.getState().locus).not.toBe('cluster');
  });

  it('treats a superseded recompute (null) as a changed table (review M1)', async () => {
    publish();
    compute.mockResolvedValue(null);
    await expect(openClusterAsRegion(1)).rejects.toThrow('The table changed.');
  });

  it('checks for a series source before recomputing anything (review M2)', async () => {
    // A 3D-only session.
    useLayerStore.setState({
      layers: [{ id: 'z', name: 'p4_zmap', volumeId: 'z', type: 'volume', visible: true, order: 0 }],
      selectedLayerId: null,
    } as never);
    publish();
    await expect(openClusterAsRegion(1)).rejects.toThrow('Needs a dataset with a lag or time axis, or a 4D layer.');
    expect(compute).not.toHaveBeenCalled();
    expect(clusterRegionUnavailable(1)).toMatch(/Needs a dataset/);
  });

  it('copies one row as CSV without the comment lines', () => {
    publish('labels-1');
    const csv = clusterRowCsv(2)!;
    const lines = csv.trim().split('\n');
    expect(lines[0].startsWith('cluster,peak,sign,voxels')).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('2,1,negative,10,')).toBe(true);
    expect(csv).not.toContain('#');
    expect(clusterRowCsv(9)).toBeNull();
  });

  it('is a ⌘K command found by "clusters as regions" and "region"', async () => {
    for (const query of ['clusters as regions', 'cluster region', 'use cluster']) {
      expect(rankCommands([CLUSTER_AS_REGION_COMMAND], query).map((c) => c.id)).toEqual(['statistics.clusterAsRegion']);
    }
    await expect(CLUSTER_AS_REGION_COMMAND.run()).rejects.toThrow('Compute clusters first.');
  });
});
