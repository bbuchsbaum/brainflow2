import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClusterTable } from '@brainflow/api';

const { mockComputeQuiet } = vi.hoisted(() => ({ mockComputeQuiet: vi.fn() }));

vi.mock('../ClusterService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ClusterService')>();
  return { ...actual, getClusterService: () => ({ computeQuiet: mockComputeQuiet }) };
});

import {
  AUTO_CLUSTER_DEBOUNCE_MS,
  autoClusterThreshold,
  initializeAutoClusters,
  isAutoClusterLayer,
  strongestPeak,
} from '../autoClusters';
import { useClusterStore, DEFAULT_CLUSTER_PARAMS, type ClusterResult } from '@/stores/clusterStore';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import type { ViewLayer } from '@/types/viewState';
import type { Layer } from '@/types/layers';

const Z = { kind: 'z', label: 'z', intentName: 'z score' };

const zLayer = (id: string, extra: Partial<LayerInfo> = {}): LayerInfo =>
  ({
    id,
    name: 'p4_zmap',
    volumeId: id,
    type: 'anatomical',
    visible: true,
    order: 0,
    source: 'file',
    sourcePath: '/f/p4_zmap.nii',
    statistic: Z,
    ...extra,
  }) as unknown as LayerInfo;

const viewLayer = (id: string, threshold: [number, number]): ViewLayer => ({
  id,
  name: id,
  volumeId: id,
  visible: true,
  opacity: 1,
  colormap: 'fmri',
  intensity: [-6.4, 6.4],
  threshold,
});

/** The fixture truth's table (truth.json b_zmap_clusters), as the backend reports it. */
const truthTable = (threshold: number): ClusterTable =>
  ({
    threshold,
    sign: 'both',
    connectivity: 26,
    minVoxels: 1,
    totalClusters: 3,
    clusters: [
      {
        id: 1,
        sign: 'positive',
        voxelCount: 165,
        peakValue: 6.4052,
        peakMm: [-40, -20, 50],
        peakIjk: [28, 56, 64],
      },
      {
        id: 2,
        sign: 'positive',
        voxelCount: 31,
        peakValue: 4.9027,
        peakMm: [42, -60, -10],
        peakIjk: [69, 36, 34],
      },
      {
        id: 3,
        sign: 'negative',
        voxelCount: 26,
        peakValue: -4.75,
        peakMm: [0, 40, 10],
        peakIjk: [48, 86, 44],
      },
    ],
  }) as unknown as ClusterTable;

const resultFor = (layerId: string, threshold: number): ClusterResult => ({
  layerId,
  layerName: 'p4_zmap',
  table: truthTable(threshold),
  regions: [null, null, null],
  computedAt: 0,
});

function addLayer(id: string, threshold: [number, number], extra: Partial<LayerInfo> = {}) {
  const info = zLayer(id, extra);
  useLayerStore.getState().addLayer(info);
  useLayerStore.getState().setLayerMetadata(id, { dataRange: { min: -4.75, max: 6.4052 } });
  useViewStateStore.getState().setViewState((d) => {
    d.layers.push(viewLayer(id, threshold));
  });
  getEventBus().emit('layer.added', { layer: info as Layer });
}

function setThreshold(id: string, t: number) {
  useViewStateStore.getState().setViewState((d) => {
    const layer = d.layers.find((l) => l.id === id);
    if (layer) layer.threshold = [-t, t];
  });
}

describe('autoClusters', () => {
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    mockComputeQuiet
      .mockReset()
      .mockImplementation(async (input: { layerId: string; threshold: number }) =>
        resultFor(input.layerId, input.threshold),
      );
    useLayerStore.getState().clearLayers();
    useViewStateStore.getState().setViewState((d) => {
      d.layers = [];
    });
    useClusterStore.getState().reset();
    stop = initializeAutoClusters();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('computes a z map at its default display threshold on load (fixture truth settings)', async () => {
    // f32 threshold as the backend stores 3.1.
    addLayer('z1', [-3.0999999046, 3.0999999046]);
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
    expect(mockComputeQuiet.mock.calls[0][0]).toMatchObject({
      layerId: 'z1',
      threshold: 3.1,
      sign: 'both',
      connectivity: 26,
      minVoxels: 1,
      extent: null,
    });
    expect(useClusterStore.getState().peaks.z1).toEqual({
      threshold: 3.1,
      sign: 'both',
      value: 6.4052,
      mm: [-40, -20, 50],
      clusters: 3,
    });
    // No table yet: it is shown.
    expect(useClusterStore.getState().result?.layerId).toBe('z1');
  });

  it('uses 3.1 for a z map without a display threshold', () => {
    useLayerStore.getState().addLayer(zLayer('z0'));
    useViewStateStore.getState().setViewState((d) => {
      d.layers.push(viewLayer('z0', [0, 0]));
    });
    expect(autoClusterThreshold('z0')).toBe(3.1);
  });

  it('recomputes once, debounced, when the threshold moves, and drops the stale run', async () => {
    addLayer('z1', [-3.1, 3.1]);
    let release!: () => void;
    mockComputeQuiet.mockImplementationOnce(
      (input: { layerId: string; threshold: number }, isCurrent: () => boolean) =>
        new Promise((resolve) => {
          release = () => resolve(isCurrent() ? resultFor(input.layerId, input.threshold) : null);
        }),
    );
    await vi.runOnlyPendingTimersAsync(); // the load run is in flight
    setThreshold('z1', 3.5);
    setThreshold('z1', 4);
    setThreshold('z1', 4.5);
    release(); // the load run finishes after the threshold moved: stale
    await vi.advanceTimersByTimeAsync(AUTO_CLUSTER_DEBOUNCE_MS - 1);
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
    expect(useClusterStore.getState().peaks.z1).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockComputeQuiet).toHaveBeenCalledTimes(2);
    expect(mockComputeQuiet.mock.calls[1][0].threshold).toBe(4.5);
    expect(useClusterStore.getState().peaks.z1?.threshold).toBe(4.5);
  });

  it('ignores view changes that leave the threshold alone', async () => {
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    useViewStateStore.getState().setViewState((d) => {
      d.layers[0].opacity = 0.5;
    });
    await vi.advanceTimersByTimeAsync(AUTO_CLUSTER_DEBOUNCE_MS * 2);
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
  });

  it('leaves non-statistic layers alone', async () => {
    useLayerStore
      .getState()
      .addLayer({ ...zLayer('t1'), name: 'T1w', sourcePath: '/f/T1w.nii', statistic: undefined });
    useViewStateStore.getState().setViewState((d) => {
      d.layers.push(viewLayer('t1', [0, 0]));
    });
    expect(isAutoClusterLayer('t1')).toBe(false);
    getEventBus().emit('layer.added', { layer: zLayer('t1') as unknown as Layer });
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).not.toHaveBeenCalled();
  });

  it('never replaces the table of another, active layer', async () => {
    useLayerStore.getState().addLayer(zLayer('other', { name: 'other' }));
    useViewStateStore.getState().setViewState((d) => {
      d.layers.push(viewLayer('other', [-2.3, 2.3]));
    });
    useClusterStore.getState().setResult(resultFor('other', 2.3));
    addLayer('z1', [-3.1, 3.1]);
    useLayerStore.getState().selectLayer('other');
    await vi.runOnlyPendingTimersAsync();
    expect(useClusterStore.getState().peaks.z1?.value).toBe(6.4052);
    expect(useClusterStore.getState().result?.layerId).toBe('other');
    // Once z1 is the active layer, its threshold change shows its table.
    useLayerStore.getState().selectLayer('z1');
    setThreshold('z1', 3.2);
    await vi.advanceTimersByTimeAsync(AUTO_CLUSTER_DEBOUNCE_MS);
    expect(useClusterStore.getState().result?.layerId).toBe('z1');
  });

  it('keeps a table at a threshold the user typed', async () => {
    useClusterStore.getState().setParams({ linked: false, threshold: 2.3 });
    useClusterStore.getState().setResult(resultFor('z9', 2.3));
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    expect(useClusterStore.getState().peaks.z1).toBeDefined();
    expect(useClusterStore.getState().result?.layerId).toBe('z9');
  });

  it('forgets a removed layer, including a run in flight', async () => {
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    setThreshold('z1', 4);
    getEventBus().emit('layer.removed', { layerId: 'z1' });
    await vi.advanceTimersByTimeAsync(AUTO_CLUSTER_DEBOUNCE_MS * 2);
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
    expect(useClusterStore.getState().peaks.z1).toBeUndefined();
  });

  it("never starts while the user's Compute is in flight, and runs after it (review H1)", async () => {
    useClusterStore.getState().setComputing();
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).not.toHaveBeenCalled();
    useClusterStore.getState().setResult(resultFor('z1', 2.5)); // the Compute lands
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
  });

  it('drops a result that lands during a Compute and redoes it after (review H1)', async () => {
    let release!: () => void;
    mockComputeQuiet.mockImplementationOnce(
      (input: { layerId: string; threshold: number }) =>
        new Promise((resolve) => {
          release = () => resolve(resultFor(input.layerId, input.threshold));
        }),
    );
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    useClusterStore.getState().setComputing();
    release();
    await vi.runOnlyPendingTimersAsync();
    expect(useClusterStore.getState().peaks.z1).toBeUndefined();
    expect(useClusterStore.getState().status).toBe('computing');
    // The user's Compute at a typed threshold lands.
    useClusterStore.getState().setParams({ linked: false, threshold: 2.3 });
    const user = resultFor('z1', 2.3);
    useClusterStore.getState().setResult(user);
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(2);
    expect(useClusterStore.getState().peaks.z1?.value).toBe(6.4052);
    // The user's table stays.
    expect(useClusterStore.getState().result).toBe(user);
  });

  it('runs one layer at a time, the active layer first (review M5)', async () => {
    const releases: Array<() => void> = [];
    mockComputeQuiet.mockImplementation(
      (input: { layerId: string; threshold: number }) =>
        new Promise((resolve) => releases.push(() => resolve(resultFor(input.layerId, input.threshold)))),
    );
    addLayer('a', [-3.1, 3.1]);
    addLayer('b', [-3.1, 3.1]);
    addLayer('c', [-3.1, 3.1]);
    useLayerStore.getState().selectLayer('c');
    await vi.runOnlyPendingTimersAsync();
    // 'a' started first (it was alone in the queue); then the active 'c'.
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
    releases.shift()!();
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(2);
    expect(mockComputeQuiet.mock.calls[1][0].layerId).toBe('c');
    releases.shift()!();
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet.mock.calls[2][0].layerId).toBe('b');
    releases.shift()!();
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(3);
  });

  it('skips image-set members, and hidden layers until they are shown (review M5)', async () => {
    addLayer('m1', [-3.1, 3.1], { imageSetId: 'set-1' });
    const info = zLayer('hid');
    useLayerStore.getState().addLayer(info);
    useViewStateStore.getState().setViewState((d) => {
      d.layers.push({ ...viewLayer('hid', [-3.1, 3.1]), visible: false });
    });
    getEventBus().emit('layer.added', { layer: info as Layer });
    await vi.runOnlyPendingTimersAsync();
    expect(isAutoClusterLayer('m1')).toBe(false);
    expect(mockComputeQuiet).not.toHaveBeenCalled();
    useViewStateStore.getState().setViewState((d) => {
      d.layers.find((l) => l.id === 'hid')!.visible = true;
    });
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet).toHaveBeenCalledTimes(1);
    expect(mockComputeQuiet.mock.calls[0][0].layerId).toBe('hid');
  });

  it('follows the panel parameters (sign, connectivity, size)', async () => {
    useClusterStore
      .getState()
      .setParams({ ...DEFAULT_CLUSTER_PARAMS, sign: 'positive', connectivity: 6, minVoxels: 10 });
    addLayer('z1', [-3.1, 3.1]);
    await vi.runOnlyPendingTimersAsync();
    expect(mockComputeQuiet.mock.calls[0][0]).toMatchObject({
      sign: 'positive',
      connectivity: 6,
      minVoxels: 10,
    });
  });
});

describe('strongestPeak against the p4 fixture truth', () => {
  const truthPath = join(homedir(), 'Documents/brainflow-p4-native/fixtures/truth.json');

  it('is the first (largest |peak|) cluster of the table', () => {
    expect(strongestPeak(truthTable(3.1), 3.1)).toEqual({
      threshold: 3.1,
      sign: 'both',
      value: 6.4052,
      mm: [-40, -20, 50],
      clusters: 3,
    });
    expect(
      strongestPeak({ ...truthTable(9), clusters: [], totalClusters: 0 } as ClusterTable, 9),
    ).toEqual({
      threshold: 9,
      sign: 'both',
      value: null,
      mm: null,
      clusters: 0,
    });
  });

  it.runIf(existsSync(truthPath))('matches truth.json (cluster 1 is the strongest)', () => {
    const truth = JSON.parse(readFileSync(truthPath, 'utf8')).b_zmap_clusters;
    expect(truth.cluster_settings).toMatchObject({
      threshold: 3.1,
      sign: 'both',
      connectivity: 26,
      min_voxels: 1,
    });
    const strongest = [...truth.clusters].sort(
      (a: { peak_value: number }, b: { peak_value: number }) =>
        Math.abs(b.peak_value) - Math.abs(a.peak_value),
    )[0];
    const table = truthTable(3.1);
    expect(table.clusters.map((c) => [c.voxelCount, c.peakValue, c.peakMm])).toEqual(
      truth.clusters.map((c: { voxels: number; peak_value: number; peak_mm: number[] }) => [
        c.voxels,
        c.peak_value,
        c.peak_mm,
      ]),
    );
    expect(strongestPeak(table, 3.1)).toMatchObject({
      value: strongest.peak_value,
      mm: strongest.peak_mm,
    });
  });
});
