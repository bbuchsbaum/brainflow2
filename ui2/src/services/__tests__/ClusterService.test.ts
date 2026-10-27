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
  isMaskLike,
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
      // The cluster-id label volume is always asked for (a row can be a series region, E3).
      request: { layerId: 'z', volumeId: 'vol-z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1, emitLabelVolume: true },
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
      '26-connected clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels.',
    );
    expect(clusterMethodsSentence({ ...TABLE, discardedClusters: 3, minVoxels: 5 }, 't(24)')).toBe(
      '26-connected clusters of |t| > 3.1 (t(24)), two-tailed, uncorrected, ≥ 5 voxels; 2 clusters, 757 voxels, 3 smaller dropped.',
    );
    expect(clusterMethodsSentence({ ...TABLE, sign: 'negative' }, 'z')).toBe(
      '26-connected clusters of z < \u22123.1, one-tailed (negative), uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels.',
    );
    // A brain-mask search without p values (S3): said once, with the mask's name.
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 228483 } },
        'z',
        { maskName: 'MNI152_T1_2mm_brain_mask' },
      ),
    ).toBe(
      '26-connected clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels; ' +
        'search volume 228,483 voxels (brain mask MNI152_T1_2mm_brain_mask).',
    );
    // Mask voxels with no map data are reported when the backend counts them (round 3 T2).
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 228483, maskVoxelsOutsideMap: 1204 } as never },
        'z',
        { maskName: 'brain_mask' },
      ),
    ).toContain('search volume 228,483 voxels (brain mask brain_mask; 1,204 mask voxels where the map is 0 or non-finite).');
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 10, maskVoxelsOutsideMap: 0 } as never },
        'z',
        { maskName: 'brain_mask' },
      ),
    ).toContain('(brain mask brain_mask).');
  });

  it('offers only masks as a search volume (round 3 T2)', () => {
    expect(isMaskLike({ name: 'MNI152_T1_2mm_brain_mask.nii.gz' })).toBe(true);
    expect(isMaskLike({ name: 'roi', type: 'mask' })).toBe(true);
    expect(isMaskLike({ name: 'roi' }, { dataRange: { min: 0, max: 1 } })).toBe(true);
    expect(isMaskLike({ name: 'seg' }, { isBinaryLike: true })).toBe(true);
    expect(isMaskLike({ name: 'MNI152_T1_2mm_brain.nii.gz' }, { dataRange: { min: 0, max: 8364 } })).toBe(false);
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
    expect(csv[0]).toBe('# zmap: 26-connected clusters of |z| > 3.1, two-tailed, uncorrected, >= 1 voxel; 2 clusters, 757 voxels.');
    expect(csv[1].split(',').slice(0, 2)).toEqual(['cluster', 'peak']);
    expect(csv[1]).toContain('centroid_x_mm,centroid_y_mm,centroid_z_mm,cog_abs_weighted_x_mm');
    expect(csv[1].endsWith('region_at_peak')).toBe(true);
    expect(csv[2]).toBe('1,1,positive,398,3184,5.965,-39.5,-19.5,50.5,1,2,3,-39.9,-19.5,50.5,-39.5,-19.5,50.5,2.9825,L_sensorimotor');
    expect(csv[3].startsWith('2,1,negative,359,2872,-4.977,0.5,40.5,10.5')).toBe(true);
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

describe('phase 4: sub-peaks, cluster-level p, cancellation', () => {
  const EXTENT = {
    method: 'rft-extent',
    fwhmMm: [6, 6, 8] as [number, number, number],
    statistic: 'z' as const,
    df: null,
    df2: null,
    statisticSource: 'header',
    clusterFormingThreshold: 3.1,
    searchVoxels: 1000,
    resels: [1, 2, 3, 4] as [number, number, number, number],
    voxelsPerResel: 64,
    expectedClusters: 0.42,
    expectedVoxelsPerCluster: 3.3,
    assumption: 'Assumes stationary smoothness of 6 x 6 x 8 mm FWHM (user-supplied). Gaussian random field theory.',
    tails: 2 as const,
  };
  const RICH: ClusterTable = {
    ...TABLE,
    maxPeaksPerCluster: 3,
    minPeakDistanceMm: 8,
    clusters: [
      { ...TABLE.clusters[0], subPeaks: [{ value: 4.25, ijk: [7, 8, 9], mm: [-30.5, -19.5, 50.5] }], pFweExtent: 0.000123, pUncorrectedExtent: 0.0000456 },
      { ...TABLE.clusters[1], subPeaks: [], pFweExtent: 0.4321, pUncorrectedExtent: 0.0412 },
    ],
    extentInference: EXTENT,
  } as ClusterTable;

  beforeEach(() => {
    useClusterStore.getState().reset();
    useLayerStore.setState({
      layers: [{ id: 'z', name: 'zmap_synthetic.nii.gz', volumeId: 'vol-z', type: 'volume', visible: true, order: 0 } as never],
    });
  });

  it('parses the FWHM field: one value or three, positive', async () => {
    const { parseFwhm } = await import('../ClusterService');
    expect(parseFwhm('8')).toBe(8);
    expect(parseFwhm(' 6, 6 x 8 ')).toEqual([6, 6, 8]);
    // The unit may be typed (round 3 addendum).
    expect(parseFwhm('8mm')).toBe(8);
    expect(parseFwhm('8 mm')).toBe(8);
    expect(parseFwhm('6 x 6 x 8 mm')).toEqual([6, 6, 8]);
    expect(parseFwhm('mm')).toBeNull();
    for (const bad of ['', '0', '-4', '6 6', 'abc', '6 6 8 8']) expect(parseFwhm(bad)).toBeNull();
  });

  it('caveats: the standing assumptions, and a warning under 3 voxels FWHM', async () => {
    const { clusterCaveats } = await import('../ClusterService');
    expect(clusterCaveats(TABLE)).toBeNull();
    expect(clusterCaveats(RICH)?.warning).toBeNull();
    const rough = { ...RICH, extentInference: { ...EXTENT, fwhmMm: [4, 4, 4] as [number, number, number] } } as ClusterTable;
    expect(clusterCaveats(rough)?.warning).toBe('Smoothness is only 2.0 voxels FWHM: p values are likely conservative and unstable.');
  });

  it('sends a search mask only when one is chosen (S3)', async () => {
    const t = transport(RICH);
    await new ClusterService(t).compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1, searchMask: 'vol-mask' });
    expect(t.invoke).toHaveBeenLastCalledWith('compute_clusters', { request: expect.objectContaining({ searchMask: 'vol-mask' }) });
    await new ClusterService(t).compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1, searchMask: null });
    expect((t.invoke as ReturnType<typeof vi.fn>).mock.lastCall?.[1].request).not.toHaveProperty('searchMask');
  });

  it('sends the extent request and region-looks-up every sub-peak', async () => {
    const t = transport(RICH);
    await new ClusterService(t).compute({
      layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1,
      extent: { fwhmMm: [6, 6, 8], statistic: 'z' },
    });
    expect(t.invoke).toHaveBeenCalledWith('compute_clusters', {
      request: expect.objectContaining({ extent: { method: 'rft-extent', fwhmMm: [6, 6, 8], statistic: 'z' } }),
    });
    expect(useClusterStore.getState().result?.subPeakRegions).toEqual([['L_sensorimotor'], []]);
  });

  it('a cancelled (superseded) request is not an error: back to the last table', async () => {
    const service = new ClusterService(transport(RICH));
    await service.compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    const cancelled = { invoke: vi.fn(async () => Promise.reject({ Input: { code: 4077, details: 'Cluster computation cancelled' } })) } as unknown as BackendTransport;
    await new ClusterService(cancelled).compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    expect(useClusterStore.getState().status).toBe('ready');
    expect(useClusterStore.getState().error).toBeNull();
  });

  it('the methods paragraph states each number once, in methods order; the CSV lists sub-peaks and p (v1 R2)', () => {
    expect(clusterMethodsSentence(RICH, 'z')).toBe(
      '26-connected clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels; ' +
        'up to 3 peaks per cluster, ≥ 8 mm apart. Cluster-level p(FWE) by Gaussian random field theory, ' +
        'two-tailed (1 \u2212 (1 \u2212 p)\u00b2), 6 × 6 × 8 mm FWHM (user-supplied); ' +
        'search volume 1,000 voxels (non-zero voxels of the map), 4.0 resels; 0.42 clusters expected per tail, 3.3 voxels each.',
    );
    // Isotropic FWHM on isotropic voxels: the voxel count inside the one parenthesis.
    const iso = { ...RICH, extentInference: { ...EXTENT, fwhmMm: [8, 8, 8] as [number, number, number], resels: [1, 2, 3, 577.16] as [number, number, number, number], searchVoxels: 43051, expectedClusters: 6.5432 } } as ClusterTable;
    expect(clusterMethodsSentence(iso, 'z')).toContain(
      '8 mm FWHM (4.0 voxels, user-supplied); search volume 43,051 voxels (non-zero voxels of the map), 577.2 resels; 6.54 clusters expected per tail',
    );
    const csv = clusterTableCsv(RICH, ['L_sensorimotor', null], { layerName: 'zmap', symbol: 'z' }, [['R_region'], []]).split('\n');
    expect(csv[0]).toContain('two-tailed (1 - (1 - p)^2), 6 x 6 x 8 mm FWHM');
    expect(csv[1]).toBe(
      '# Assumes stationary smoothness; approximate unless the cluster-forming threshold is high and the map is smooth relative to its voxels (SPM spm_P_RF).',
    );
    expect([...csv.join('\n')].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    const header = csv[2].split(',');
    expect(header.slice(0, 7)).toEqual(['cluster', 'peak', 'sign', 'voxels', 'volume_mm3', 'p_fwe_extent', 'p_unc_extent']);
    const rows = csv.slice(3, -1).map((r) => r.split(','));
    expect(rows.map((r) => r.slice(0, 2))).toEqual([['1', '1'], ['1', '2'], ['2', '1']]);
    const at = (r: string[], name: string) => r[header.indexOf(name)];
    expect(at(rows[0], 'p_fwe_extent')).toBe('0.000123');
    expect(at(rows[1], 'peak_value')).toBe('4.25');
    expect(at(rows[1], 'peak_x_mm')).toBe('-30.5');
    expect(at(rows[1], 'voxels')).toBe('');
    expect(at(rows[1], 'region_at_peak')).toBe('R_region');
    expect(rows.every((r) => r.length === header.length)).toBe(true);
  });
});
