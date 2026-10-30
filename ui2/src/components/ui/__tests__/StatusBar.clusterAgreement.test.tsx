/**
 * QA design decisions 2026-10-30, section 3: the status bar's ijk and the
 * cluster table's peak ijk agree for the same layer, also when that layer is
 * not on the reference (bottom volume) grid.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterTable } from '@brainflow/api';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));
vi.mock('@/services/ClusterService', async (orig) => {
  const actual = await orig<typeof import('@/services/ClusterService')>();
  const noop = vi.fn(async () => null);
  return {
    ...actual,
    getClusterService: () => ({ compute: noop, selectCluster: noop, goToExtremum: noop, goToSubPeak: noop }),
  };
});
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
vi.mock('@/hooks/useLayerValueAtWorld', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useLayerValueAtWorld')>()),
  useLayerValueAtWorld: () => null,
}));

import { StatusBar } from '../StatusBar';
import { ClusterPanel } from '@/components/panels/ClusterPanel';
import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import {
  formatVoxelIndex,
  resolveReadoutGrid,
  resolveVoxelGridReference,
  worldToVoxelIndex,
} from '@/utils/voxelSnap';
import { transformVoxelToWorldColumnMajor } from '@/utils/voxelTransform';

// Reference: 2 mm MNI grid. zstat1: 3 mm, another origin (a coarser BOLD map).
const T1_V2W = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -95.5, -131.5, -77.5, 1];
const T1_W2V = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 47.75, 65.75, 38.75, 1];
const Z_V2W = [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, -90, -126, -72, 1];
const Z_W2V = [1 / 3, 0, 0, 0, 0, 1 / 3, 0, 0, 0, 0, 1 / 3, 0, 30, 42, 24, 1];
const Z = {
  kind: 'z' as const,
  intentCode: 5,
  intentParams: [0, 0, 0] as [number, number, number],
  intentName: '',
  dof: [],
  label: 'z',
  fromDescription: false,
  positiveDataLabel: null,
};

// The backend reports the peak on the map's own grid, with its world mm.
const PEAK_IJK: [number, number, number] = [23, 41, 30];
const PEAK_MM = transformVoxelToWorldColumnMajor(Z_V2W, PEAK_IJK) as [number, number, number];

const TABLE: ClusterTable = {
  clusters: [
    {
      id: 1,
      sign: 'positive',
      voxelCount: 12,
      volumeMm3: 324,
      peakValue: 5.2,
      peakIjk: PEAK_IJK,
      peakMm: PEAK_MM,
      meanValue: 4,
      centroidIjk: PEAK_IJK,
      centroidMm: PEAK_MM,
      weightedCentroidMm: PEAK_MM,
      bboxIjkMin: PEAK_IJK,
      bboxIjkMax: PEAK_IJK,
      bboxMmMin: PEAK_MM,
      bboxMmMax: PEAK_MM,
    },
  ],
  threshold: Math.fround(3.1),
  sign: 'both',
  connectivity: 26,
  minVoxels: 1,
  timepoint: null,
  voxelVolumeMm3: 27,
  suprathresholdVoxels: 12,
  totalClusters: 1,
  discardedClusters: 0,
  truncated: false,
};

function seed() {
  useLayerStore.setState({
    layers: [
      { id: 't1', name: 'T1.nii.gz', volumeId: 't1', type: 'volume', visible: true, order: 0 },
      { id: 'z', name: 'zstat1.nii.gz', volumeId: 'z', type: 'volume', visible: true, order: 1, statistic: Z },
    ] as never,
    selectedLayerId: 'z',
    layerMetadata: new Map([
      ['t1', { voxelToWorld: T1_V2W, worldToVoxel: T1_W2V, dimensions: [96, 114, 96] }],
      ['z', { voxelToWorld: Z_V2W, worldToVoxel: Z_W2V, dimensions: [61, 73, 61], dataRange: { min: -4, max: 5.2 } }],
    ]) as never,
  });
  useStatusReadoutStore.setState({ override: null } as never);
  useViewStateStore.getState().setViewState((state) => {
    // Go to peak places the crosshair exactly (no snap to the reference grid).
    state.crosshair.world_mm = [...PEAK_MM];
    state.layers = [
      { id: 't1', name: 't1', volumeId: 't1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 255], threshold: [0, 0] },
      { id: 'z', name: 'z', volumeId: 'z', visible: true, opacity: 1, colormap: 'fmri', intensity: [-6, 6], threshold: [-3.1, 3.1] },
    ] as never;
  });
  useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zstat1.nii.gz', table: TABLE, regions: [null], computedAt: 0 });
}

describe('status bar and cluster table ijk agree', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    useClusterStore.getState().reset();
    seed();
  });

  it('the readout grid is the selected layer’s own grid, not the reference', () => {
    const { layers, layerMetadata } = useLayerStore.getState();
    const grid = resolveReadoutGrid('z', layers, layerMetadata)!;
    expect(grid.layerId).toBe('z');
    expect(grid.isReference).toBe(false);
    expect(worldToVoxelIndex(PEAK_MM, grid)).toEqual(PEAK_IJK);
    // The bug this guards against: the reference grid gives another index.
    const reference = resolveVoxelGridReference(layers, layerMetadata)!;
    expect(worldToVoxelIndex(PEAK_MM, reference)).not.toEqual(PEAK_IJK);
  });

  it('shows the same peak ijk in the status bar and the cluster table, each naming zstat1', () => {
    const status = render(<StatusBar />);
    const voxel = status.container.querySelector('[data-slot="voxel"] .status-value');
    expect(voxel?.textContent).toBe(`ijk ${formatVoxelIndex(PEAK_IJK)} (zstat1)`);
    expect(voxel?.textContent).toBe('ijk 23, 41, 30 (zstat1)');
    status.unmount();

    render(<ClusterPanel />);
    const header = screen.getByRole('columnheader', { name: /Peak ijk/ });
    expect(header).toHaveTextContent('Peak ijk (zstat1)');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText(formatVoxelIndex(PEAK_IJK)));
    expect(row).toBeDefined();
  });
});
