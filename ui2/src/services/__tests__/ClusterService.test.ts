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
  atDisplayPrecision,
  clusterTestText,
  clusterThresholds,
  displayThresholdBounds,
  formatClusterP,
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

describe('ClusterService · clusters on load (QA features §8)', () => {
  beforeEach(() => {
    useClusterStore.getState().reset();
    useLayerStore.setState({
      layers: [{ id: 'z', name: 'zmap_synthetic.nii.gz', volumeId: 'vol-z', type: 'volume', visible: true, order: 0 } as never],
    });
  });

  it('computeQuiet returns the result without touching the panel status or table', async () => {
    const t = transport(TABLE);
    const result = await new ClusterService(t).computeQuiet(
      { layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 },
      () => true,
    );
    // Its own backend order (never cancels a Compute) and no label volume (review H1, H2).
    expect(t.invoke).toHaveBeenCalledWith('compute_clusters', {
      request: { layerId: 'z', volumeId: 'vol-z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1, emitLabelVolume: false, quiet: true },
    });
    expect(result?.regions).toEqual(['L_sensorimotor', null]);
    expect(useClusterStore.getState()).toMatchObject({ status: 'idle', result: null });
  });

  it('computeQuiet drops a stale or superseded result', async () => {
    const service = new ClusterService(transport(TABLE));
    const input = { layerId: 'z', threshold: 3.1, sign: 'both' as const, connectivity: 26 as const, minVoxels: 1 };
    await expect(service.computeQuiet(input, () => false)).resolves.toBeNull();
    const cancelled = { invoke: vi.fn(async () => Promise.reject({ InputError: { code: 4077, details: 'superseded' } })) };
    await expect(new ClusterService(cancelled as unknown as BackendTransport).computeQuiet(input, () => true)).resolves.toBeNull();
  });

  it('goToPeak moves the crosshair exactly and selects the row of a shown table', async () => {
    const service = new ClusterService(transport(TABLE));
    await service.compute({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    useClusterStore.getState().setPeak('z', { threshold: 3.1, sign: 'both', value: 5.965, mm: [-39.5, -19.5, 50.5], clusters: 2 });
    const setCrosshair = vi.spyOn(useViewStateStore.getState(), 'setCrosshair').mockResolvedValue();
    await service.goToPeak('z');
    expect(setCrosshair).toHaveBeenCalledWith([-39.5, -19.5, 50.5], true, false, undefined, { snap: false });
    expect(useClusterStore.getState().selectedId).toBe(1);
    setCrosshair.mockRestore();
  });
});

describe('asymmetric display thresholds (QA 2026-10-31 N6)', () => {
  it('splits the hidden band into per-tail thresholds at display precision', () => {
    expect(atDisplayPrecision(Math.fround(3.92923))).toBe(3.93);
    expect(atDisplayPrecision(Math.fround(3.1))).toBe(3.1);
    expect(displayThresholdBounds([-3.1, Math.fround(3.92923)])).toEqual({ positive: 3.93, negative: 3.1 });
    expect(displayThresholdBounds([0, 0])).toBeNull();
  });

  it('carries both tails only for sign "both" and only when they differ', () => {
    const b = { positive: 3.93, negative: 3.1 };
    expect(clusterThresholds(b, 'both')).toEqual({ threshold: 3.93, negativeThreshold: 3.1, sign: 'both' });
    expect(clusterThresholds(b, 'positive')).toEqual({ threshold: 3.93, negativeThreshold: null, sign: 'positive' });
    // The negative tail's own threshold.
    expect(clusterThresholds(b, 'negative')).toEqual({ threshold: 3.1, negativeThreshold: null, sign: 'negative' });
    expect(clusterThresholds({ positive: 3.1, negative: 3.1 }, 'both')).toEqual({ threshold: 3.1, negativeThreshold: null, sign: 'both' });
  });

  it('a one-sided band thresholds one tail, never a 0 on the other (review H2)', () => {
    // [0, t]: every negative value is shown, so only the positive tail is thresholded.
    expect(displayThresholdBounds([0, 3.93])).toEqual({ positive: 3.93, negative: null });
    expect(displayThresholdBounds([-3.1, 0])).toEqual({ positive: null, negative: 3.1 });
    // [2, 5]: everything below 2 is shown (negatives too).
    expect(displayThresholdBounds([2, 5])).toEqual({ positive: 5, negative: null });
    expect(displayThresholdBounds([-5, -2])).toEqual({ positive: null, negative: 5 });
    // Sign "both" over a one-sided band searches the thresholded sign only.
    expect(clusterThresholds({ positive: 3.93, negative: null }, 'both')).toEqual({ threshold: 3.93, negativeThreshold: null, sign: 'positive' });
    expect(clusterThresholds({ positive: null, negative: 3.1 }, 'both')).toEqual({ threshold: 3.1, negativeThreshold: null, sign: 'negative' });
    // Asking only for the unthresholded tail: nothing to search.
    expect(clusterThresholds({ positive: 3.93, negative: null }, 'negative')).toBeNull();
  });

  it('says the test the table was formed with', () => {
    expect(clusterTestText({ threshold: 3.93, negativeThreshold: 3.1, sign: 'both' }, 'z')).toBe('z > 3.93 or z < \u22123.1');
    expect(clusterTestText({ threshold: 3.1, sign: 'both' }, 'z')).toBe('|z| > 3.1');
    expect(clusterTestText({ threshold: 3.1, sign: 'negative' }, 'z')).toBe('z < \u22123.1');
    expect(clusterMethodsSentence({ ...TABLE, threshold: 3.93, negativeThreshold: 3.1 }, 'z')).toMatch(
      /^26-connected clusters of z > 3\.93 or z < \u22123\.1, two-tailed, uncorrected/,
    );
  });

  it('sends the negative tail to compute_clusters', async () => {
    useLayerStore.setState({
      layers: [{ id: 'z', name: 'z', volumeId: 'vol-z', type: 'volume', visible: true, order: 0 } as never],
    });
    const t = transport(TABLE);
    await new ClusterService(t).compute({ layerId: 'z', threshold: 3.93, negativeThreshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
    expect(t.invoke).toHaveBeenCalledWith('compute_clusters', {
      request: expect.objectContaining({ threshold: 3.93, negativeThreshold: 3.1 }),
    });
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
    // A mask search without p values (S3): said once, with the mask's name; "restricted to",
    // never "brain mask" (a mask may be a small ROI; deliberate wording change, v4 fidelity 2).
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 228483 } },
        'z',
        { maskName: 'MNI152_T1_2mm_brain_mask' },
      ),
    ).toBe(
      '26-connected clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 2 clusters, 757 voxels; ' +
        'search volume 228,483 voxels (restricted to mask MNI152_T1_2mm_brain_mask).',
    );
    // Mask voxels with no map data are reported when the backend counts them (round 3 T2).
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 228483, maskVoxelsOutsideMap: 1204 } as never },
        'z',
        { maskName: 'brain_mask' },
      ),
    ).toContain('search volume 228,483 voxels (restricted to mask brain_mask; 1,204 mask voxels where the map is 0 or non-finite).');
    expect(
      clusterMethodsSentence(
        { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 10, maskVoxelsOutsideMap: 0 } as never },
        'z',
        { maskName: 'brain_mask' },
      ),
    ).toContain('(restricted to mask brain_mask).');
  });

  it('offers only binary volumes or whole-token "mask" names as a search volume (round 4 C7)', () => {
    // Binary data, by the loader's flag or an exact 0..1 range.
    expect(isMaskLike({ name: 'seg' }, { isBinaryLike: true })).toBe(true);
    expect(isMaskLike({ name: 'roi' }, { dataRange: { min: 0, max: 1 } })).toBe(true);
    // Whole-token names: brain_mask, brainmask, _mask.nii.
    expect(isMaskLike({ name: 'MNI152_T1_2mm_brain_mask.nii.gz' })).toBe(true);
    expect(isMaskLike({ name: 'sub-01_brainmask.nii.gz' })).toBe(true);
    expect(isMaskLike({ name: 'roi', sourcePath: '/d/sub-01_desc-brain_mask.nii.gz' })).toBe(true);
    // Not "masked"; not a type guessed from the name.
    expect(isMaskLike({ name: 'bold_masked.nii.gz' })).toBe(false);
    expect(isMaskLike({ name: 'roi', type: 'mask' })).toBe(false);
    // A probability map is never a mask, whatever its name.
    expect(isMaskLike({ name: 'GM_mask_prob.nii.gz' }, { isBinaryLike: false, dataRange: { min: 0, max: 1 } })).toBe(false);
    expect(isMaskLike({ name: 'gm_probseg.nii.gz' }, { isBinaryLike: false, dataRange: { min: 0, max: 0.98 } })).toBe(false);
    // B14: the native flag is a true {0, 1} test and decides (deliberate change: a flagged volume is trusted;
    // an all-ones whole-grid mask, range 1..1, is a mask).
    expect(isMaskLike({ name: 'grid' }, { isBinaryLike: true, dataRange: { min: 1, max: 1 } })).toBe(true);
    expect(isMaskLike({ name: 'empty_mask' }, { isBinaryLike: true, dataRange: { min: 0, max: 0 } })).toBe(false);
    expect(isMaskLike({ name: 'amygdala_roi' }, { isBinaryLike: true, dataRange: { min: 0, max: 1 } })).toBe(true);
    // An anatomical image is not offered.
    expect(isMaskLike({ name: 'MNI152_T1_2mm_brain.nii.gz' }, { dataRange: { min: 0, max: 8364 } })).toBe(false);
  });

  it('prints p(FWE) just below 1 with four decimals, not "1.000" (round 4 C9)', () => {
    expect(formatClusterP(0.99964)).toBe('0.9996');
    expect(formatClusterP(0.0079)).toBe('0.008');
    expect(formatClusterP(0.0004)).toBe('< 0.001');
    expect(formatClusterP(1)).toBe('1.000');
    // Never 1 for p < 1 (v4 fidelity 4).
    expect(formatClusterP(0.99996)).toBe('> 0.9999');
  });


  it('leaves the weighted COG empty when the backend did not send it (v3 fidelity)', () => {
    const noCog = { ...TABLE, clusters: [{ ...TABLE.clusters[0], weightedCentroidMm: undefined as never, centroidMm: [-39.913, -19.5, 50.5] as [number, number, number] }] };
    const row = clusterTableCsv(noCog, ['L_sensorimotor'], { layerName: 'zmap', symbol: 'z' }).split('\n')[2].split(',');
    const header = clusterTableCsv(noCog, [null], { layerName: 'zmap', symbol: 'z' }).split('\n')[1].split(',');
    const at = (name: string) => row[header.indexOf(name)];
    expect(at('centroid_x_mm')).toBe('-39.91');
    expect([at('cog_abs_weighted_x_mm'), at('cog_abs_weighted_y_mm'), at('cog_abs_weighted_z_mm')]).toEqual(['', '', '']);
  });

  it('withheld cluster p: empty p columns and the reason as a "#" line (B12)', () => {
    const reason =
      'This map looks pre-thresholded (no |z| < 3.1 among non-zero voxels); cluster p needs the unthresholded map or a search mask.';
    const withheld: ClusterTable = { ...TABLE, extentInference: null, extentWithheld: { code: 4080, reason } };
    const csv = clusterTableCsv(withheld, ['L_sensorimotor', null], { layerName: 'zmap', symbol: 'z' }).split('\n');
    expect(csv).toContain(`# cluster p withheld: ${reason}`);
    const header = csv.find((l) => l.startsWith('cluster,'))!.split(',');
    const row = csv[csv.indexOf(header.join(',')) + 1].split(',');
    expect(row[header.indexOf('p_fwe_extent')]).toBe('');
    expect(row[header.indexOf('p_unc_extent')]).toBe('');
  });

  it('the methods state mask voxels outside the map from searchVolume.maskVoxelsOutsideMap', () => {
    const masked: ClusterTable = {
      ...TABLE,
      searchVolume: { kind: 'mask', maskVolumeId: 'm', voxels: 5000, maskVoxelsOutsideMap: 321 },
    };
    expect(clusterMethodsSentence(masked, 'z', { maskName: 'brain_mask' })).toContain(
      'restricted to mask brain_mask; 321 mask voxels where the map is 0 or non-finite',
    );
    const none: ClusterTable = { ...masked, searchVolume: { ...masked.searchVolume!, maskVoxelsOutsideMap: null } };
    expect(clusterMethodsSentence(none, 'z', { maskName: 'brain_mask' })).not.toContain('where the map is 0');
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
