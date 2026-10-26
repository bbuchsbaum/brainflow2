import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterTable } from '@brainflow/api';

const { compute, selectCluster, goToExtremum } = vi.hoisted(() => ({
  compute: vi.fn(async () => null),
  selectCluster: vi.fn(async () => undefined),
  goToExtremum: vi.fn(async () => null),
}));
vi.mock('@/services/ClusterService', async (orig) => {
  const actual = await orig<typeof import('@/services/ClusterService')>();
  return { ...actual, getClusterService: () => ({ compute, selectCluster, goToExtremum }) };
});
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { ClusterPanel } from '../ClusterPanel';
import { colormapEnds, displayThresholdMagnitude } from '@/services/ClusterService';
import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

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

const summary = (id: number, peak: number, mm: [number, number, number]) => ({
  id,
  sign: peak > 0 ? ('positive' as const) : ('negative' as const),
  voxelCount: 10 * id,
  volumeMm3: 80 * id,
  peakValue: peak,
  peakIjk: [1, 2, 3] as [number, number, number],
  peakMm: mm,
  meanValue: peak,
  centroidIjk: [1, 2, 3] as [number, number, number],
  centroidMm: mm,
  weightedCentroidMm: mm,
  bboxIjkMin: [0, 0, 0] as [number, number, number],
  bboxIjkMax: [0, 0, 0] as [number, number, number],
  bboxMmMin: mm,
  bboxMmMax: mm,
});

const TABLE: ClusterTable = {
  clusters: [summary(1, 5.966, [-39.5, -19.5, 50.5]), summary(2, -4.977, [0.5, 40.5, 10.5])],
  threshold: Math.fround(3.1),
  sign: 'both',
  connectivity: 26,
  minVoxels: 1,
  timepoint: null,
  voxelVolumeMm3: 8,
  suprathresholdVoxels: 30,
  totalClusters: 2,
  discardedClusters: 0,
  truncated: false,
};

function seed(threshold: [number, number] = [-3.1, 3.1]) {
  useLayerStore.setState({
    layers: [
      { id: 't1', name: 'T1.nii.gz', volumeId: 't1', type: 'volume', visible: true, order: 0 },
      { id: 'z', name: 'zmap_synthetic.nii.gz', volumeId: 'z', type: 'volume', visible: true, order: 1, statistic: Z },
    ] as never,
    selectedLayerId: 'z',
    layerMetadata: new Map([['z', { dataRange: { min: -4.98, max: 5.97 } }]]),
  });
  useViewStateStore.getState().setViewState((state) => {
    state.layers = [
      { id: 't1', name: 't1', volumeId: 't1', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 255], threshold: [0, 0] },
      { id: 'z', name: 'z', volumeId: 'z', visible: true, opacity: 1, colormap: 'fmri', intensity: [-6, 6], threshold },
    ] as never;
  });
}

describe('ClusterPanel', () => {
  beforeEach(() => {
    compute.mockClear();
    selectCluster.mockClear();
    useViewStateStore.getState().resetToDefaults();
    useClusterStore.getState().reset();
    seed();
  });

  it('reads like a sentence and seeds |z| from the display threshold', () => {
    render(<ClusterPanel />);
    expect(screen.getByTestId('cluster-layer')).toHaveTextContent('zmap_synthetic');
    expect(screen.getByLabelText('Cluster threshold, absolute z')).toHaveValue(3.1);
    expect(screen.getByRole('radiogroup', { name: 'Connectivity' })).toBeInTheDocument();
    expect(screen.getByTestId('cluster-empty')).toHaveTextContent('Compute clusters for zmap_synthetic.');
  });

  it('computes with the toolbar parameters', () => {
    render(<ClusterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(compute).toHaveBeenCalledWith({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1 });
  });

  it('disables Compute and Go to max / min, with the reason, when the layer is not a statistic', () => {
    useLayerStore.setState({ selectedLayerId: 't1' });
    render(<ClusterPanel />);
    for (const name of ['Compute', 'Go to max', 'Go to min']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Clusters need a statistical layer (a z, t or F map)');
    }
  });

  it('disables Compute for an invalid minimum size, without console errors', () => {
    const error = vi.spyOn(console, 'error');
    render(<ClusterPanel />);
    fireEvent.change(screen.getByLabelText('Min'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Compute' })).toBeDisabled();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('lists clusters, moves the crosshair on click and arrow keys, and states the method', () => {
    useClusterStore.getState().setResult({
      layerId: 'z',
      layerName: 'zmap_synthetic.nii.gz',
      table: TABLE,
      regions: ['L_sensorimotor', null],
      computedAt: 0,
    });
    render(<ClusterPanel />);
    const row1 = screen.getByTestId('cluster-row-1');
    expect(row1).toHaveTextContent('5.97');
    expect(row1).toHaveTextContent('L_sensorimotor');
    expect(screen.getByTestId('cluster-row-2')).toHaveTextContent('−4.98');
    expect(screen.getByTestId('cluster-row-2')).toHaveTextContent('—');
    fireEvent.click(row1);
    expect(selectCluster).toHaveBeenCalledWith(1);
    act(() => row1.focus());
    fireEvent.keyDown(row1, { key: 'ArrowDown' });
    expect(selectCluster).toHaveBeenLastCalledWith(2);
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent(
      '26-connected clusters of |z| > 3.1, two-sided, uncorrected, ≥ 1 voxel; 2 clusters, 30 voxels',
    );
  });

  it('a table from another statistical layer keeps its own units and is not copied as current', () => {
    useClusterStore.getState().setResult({
      layerId: 'z',
      layerName: 'zmap_synthetic.nii.gz',
      table: TABLE,
      regions: [null, null],
      computedAt: 0,
    });
    // A t map becomes the active layer.
    const T = { ...Z, kind: 't' as const, intentCode: 3, label: 't(24)', dof: [24] };
    useLayerStore.setState((st) => ({
      layers: [
        ...st.layers,
        { id: 't', name: 'tmap.nii.gz', volumeId: 't', type: 'volume', visible: true, order: 2, statistic: T } as never,
      ],
      selectedLayerId: 't',
    }));
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        ...state.layers,
        { id: 't', name: 't', volumeId: 't', visible: true, opacity: 1, colormap: 'fmri', intensity: [-6, 6], threshold: [-3.1, 3.1] } as never,
      ];
    });
    render(<ClusterPanel />);
    expect(screen.getByTestId('cluster-stale')).toHaveTextContent('Table is for zmap_synthetic');
    // Headed by the table's statistic (z), not the active layer's (t).
    expect(screen.getByRole('columnheader', { name: /^Peak z/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Peak t/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy CSV' })).toBeDisabled();
  });

  it('says the table is stale when the display threshold changes', () => {
    useClusterStore.getState().setResult({
      layerId: 'z',
      layerName: 'zmap_synthetic.nii.gz',
      table: TABLE,
      regions: [null, null],
      computedAt: 0,
    });
    seed([-2.3, 2.3]);
    render(<ClusterPanel />);
    expect(screen.getByTestId('cluster-stale')).toHaveTextContent('Parameters changed since this table. Compute to update.');
  });

  it('shows errors as an alert', () => {
    useClusterStore.getState().setError('Connectivity must be 6, 18 or 26');
    render(<ClusterPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connectivity must be 6, 18 or 26');
  });

  it('helpers: colormap ends and display threshold magnitude', () => {
    expect(colormapEnds('fmri')).toEqual(['#0000ff', '#ff0000']);
    expect(displayThresholdMagnitude([-3.1, 3.1])).toBe(3.1);
    expect(displayThresholdMagnitude([0, 2])).toBe(2);
  });

  it('sorts by voxels and back by rank from keyboard-operable headers with aria-sort', () => {
    useClusterStore.getState().setResult({
      layerId: 'z',
      layerName: 'zmap_synthetic.nii.gz',
      table: TABLE,
      regions: ['L_sensorimotor', null],
      computedAt: 0,
    });
    render(<ClusterPanel />);
    const rowIds = () => screen.getAllByTestId(/^cluster-row-/).map((r) => r.getAttribute('data-testid'));
    expect(rowIds()).toEqual(['cluster-row-1', 'cluster-row-2']);
    const voxels = screen.getByRole('button', { name: 'Voxels' });
    expect(voxels.closest('th')).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(voxels);
    // Cluster 2 has 20 voxels, cluster 1 has 10: descending first.
    expect(rowIds()).toEqual(['cluster-row-2', 'cluster-row-1']);
    expect(voxels.closest('th')).toHaveAttribute('aria-sort', 'descending');
    // Regions travel with their cluster.
    expect(screen.getByTestId('cluster-row-1')).toHaveTextContent('L_sensorimotor');
    fireEvent.click(screen.getByRole('button', { name: '#' }));
    expect(rowIds()).toEqual(['cluster-row-1', 'cluster-row-2']);
    expect(screen.getByRole('button', { name: '#' }).closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });
});

