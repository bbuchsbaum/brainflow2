import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterTable } from '@brainflow/api';

const computeMock = () => compute;
const { compute, selectCluster, goToExtremum, goToSubPeak } = vi.hoisted(() => ({
  goToSubPeak: vi.fn(async () => undefined),
  compute: vi.fn(async () => null),
  selectCluster: vi.fn(async () => undefined),
  goToExtremum: vi.fn(async () => null),
}));
vi.mock('@/services/ClusterService', async (orig) => {
  const actual = await orig<typeof import('@/services/ClusterService')>();
  return { ...actual, getClusterService: () => ({ compute, selectCluster, goToExtremum, goToSubPeak }) };
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
    // Cluster-level p is off by default (phase 4 C2: opt-in).
    expect(compute).toHaveBeenCalledWith({ layerId: 'z', threshold: 3.1, sign: 'both', connectivity: 26, minVoxels: 1, extent: null });
  });

  it('cluster p (RFT) is opt-in and needs a stated FWHM, one value or three (C2)', () => {
    render(<ClusterPanel />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster p (RFT)' }));
    const compute = screen.getByRole('button', { name: 'Compute' });
    expect(compute).toBeDisabled();
    expect(screen.getByTestId('cluster-reason')).toHaveTextContent('Enter the FWHM in mm');
    fireEvent.change(screen.getByLabelText('FWHM'), { target: { value: '6 6 8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(computeMock()).toHaveBeenLastCalledWith(
      expect.objectContaining({ extent: { fwhmMm: [6, 6, 8], statistic: null } }),
    );
  });

  it('shows sub-peaks behind a disclosure, with their regions, and p columns with the assumption (C1/C2)', () => {
    const withPeaks: ClusterTable = {
      ...TABLE,
      maxPeaksPerCluster: 3,
      minPeakDistanceMm: 8,
      clusters: [
        {
          ...TABLE.clusters[0],
          subPeaks: [{ value: 4.25, ijk: [7, 8, 9], mm: [-30.5, -19.5, 50.5] }],
          pFweExtent: 0.0004,
          pUncorrectedExtent: 0.00001,
        },
        { ...TABLE.clusters[1], subPeaks: [], pFweExtent: 0.4321, pUncorrectedExtent: 0.0412 },
      ],
      extentInference: {
        method: 'rft-extent',
        fwhmMm: [8, 8, 8],
        statistic: 'z',
        df: null,
        df2: null,
        statisticSource: 'header',
        clusterFormingThreshold: 3.1,
        searchVoxels: 1000,
        resels: [1, 2, 3, 4],
        voxelsPerResel: 64,
        expectedClusters: 0.42,
        expectedVoxelsPerCluster: 3.3,
        assumption: 'Assumes stationary smoothness of 8 mm FWHM (user-supplied).',
      },
    } as ClusterTable;
    useClusterStore.getState().setParams({ extentP: true, fwhmText: '8' });
    act(() =>
      useClusterStore.getState().setResult({
        layerId: 'z',
        layerName: 'zmap_synthetic.nii.gz',
        table: withPeaks,
        regions: ['A', null],
        subPeakRegions: [['B'], []],
        computedAt: 0,
      }),
    );
    render(<ClusterPanel />);
    expect(screen.getByTestId('cluster-pfwe-1')).toHaveTextContent('< 0.001');
    expect(screen.getByTestId('cluster-pfwe-2')).toHaveTextContent('0.432');
    // One methods paragraph, each number once (v1 R2); the caveats behind a disclosure.
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent('8 mm FWHM (4.0 voxels, user-supplied); search volume 1,000 voxels');
    expect(screen.queryByTestId('cluster-assumption')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Assumptions/ }));
    expect(screen.getByTestId('cluster-assumption')).toHaveTextContent('Assumes stationary smoothness');
    expect(screen.getByRole('button', { name: /Assumptions/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('cluster-subpeak-1-2')).toBeNull();
    const row = screen.getByTestId('cluster-row-1');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('cluster-row-2')).not.toHaveAttribute('aria-expanded');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    const sub = screen.getByTestId('cluster-subpeak-1-2');
    // Keyboard reaches the sub-peak (treegrid level 2); Enter goes to it.
    expect(screen.getByRole('treegrid')).toBeInTheDocument();
    expect(sub).toHaveAttribute('aria-level', '2');
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(sub);
    fireEvent.keyDown(sub, { key: 'Enter' });
    expect(goToSubPeak).toHaveBeenCalledWith(1, 0);
    fireEvent.keyDown(sub, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row);
    // Indented under its cluster (v0 visual 5): "↳ 2", named "cluster 1, peak 2".
    expect(sub).toHaveTextContent('↳ 2');
    expect(sub.querySelector('[aria-label="cluster 1, peak 2"]')).not.toBeNull();
    expect(sub).toHaveTextContent('4.25');
    expect(sub).toHaveTextContent('B');
    fireEvent.click(screen.getByRole('button', { name: 'Hide 1 sub-peak of cluster 1' }));
    // Selection stays visible under focus (v0 visual 4): the edge is on the
    // first cell, the focus ring on the row.
    act(() => useClusterStore.getState().select(1));
    const selectedRow = screen.getByTestId('cluster-row-1');
    selectedRow.focus();
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    expect(selectedRow.querySelector('[data-testid="cluster-selected-edge"]')?.className).toMatch(/inset_2px_0_0/);
    expect(screen.getByTestId('cluster-row-2').querySelector('[data-testid="cluster-selected-edge"]')).toBeNull();
    expect(screen.queryByTestId('cluster-subpeak-1-2')).toBeNull();
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

  it('a z map with no display threshold seeds |z| > 3.1 and says so, never 0 (review R7, v5)', () => {
    seed([0, 0]);
    render(<ClusterPanel />);
    expect(screen.getByLabelText('Cluster threshold, absolute z')).toHaveValue(3.1);
    expect(screen.getByTestId('cluster-reason')).toHaveTextContent('Default threshold 3.1 (the layer has no display threshold)');
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(compute).toHaveBeenCalledWith(expect.objectContaining({ threshold: 3.1 }));
  });

  it('an F map with no display threshold waits for a value, with the reason as text', () => {
    seed([0, 0]);
    const F = { ...Z, kind: 'F' as const, intentCode: 4, label: 'F(2,30)', dof: [2, 30] };
    useLayerStore.setState((st) => ({
      layers: st.layers.map((l) => (l.id === 'z' ? { ...l, statistic: F } : l)) as never,
    }));
    render(<ClusterPanel />);
    const button = screen.getByRole('button', { name: 'Compute' });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('cluster-reason')).toHaveTextContent('Enter a threshold');
    expect(button).toHaveAttribute('aria-describedby', 'cluster-reason');
  });

  it('a label map selected: Compute says why; the z table stays usable, with "Select zmap_synthetic" (v1 function 2)', () => {
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: TABLE, regions: [null, null], computedAt: 0 });
    useLayerStore.setState((st) => ({
      layers: [...st.layers, { id: 'atlas', name: 'atlas-synth3_dseg.nii.gz', volumeId: 'atlas', type: 'label', visible: true, order: 2 } as never],
      selectedLayerId: 'atlas',
    }));
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        ...state.layers,
        { id: 'atlas', name: 'atlas', volumeId: 'atlas', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 3], threshold: [0, 0], layerMode: 'label' } as never,
      ];
    });
    render(<ClusterPanel />);
    expect(screen.getByTestId('cluster-layer')).toHaveTextContent('atlas-synth3_dseg');
    expect(screen.getByRole('button', { name: 'Compute' })).toHaveAttribute('title', 'Clusters need a statistical layer (a z, t or F map)');
    // Deliberate change: the table is still right for its own layer, so it is
    // shown and copyable, named, never "Compute to update" (Compute would
    // target the atlas).
    expect(screen.getByTestId('cluster-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-elsewhere')).toHaveTextContent('Table for zmap_synthetic.');
    expect(screen.queryByTestId('cluster-stale')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy CSV' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select zmap_synthetic' }));
  });

  it('a label map selected: parameters are disabled, not invalid, and the reason is visible text (QA 9.5)', () => {
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: TABLE, regions: [null, null], computedAt: 0 });
    useLayerStore.setState((st) => ({
      layers: [...st.layers, { id: 'atlas', name: 'FreeSurfer ASEG', volumeId: 'atlas', type: 'label', visible: true, order: 2 } as never],
      selectedLayerId: 'atlas',
    }));
    useViewStateStore.getState().setViewState((state) => {
      state.layers = [
        ...state.layers,
        { id: 'atlas', name: 'atlas', volumeId: 'atlas', visible: true, opacity: 1, colormap: 'gray', intensity: [0, 50], threshold: [0, 0], layerMode: 'label' } as never,
      ];
    });
    render(<ClusterPanel />);
    const threshold = screen.getByLabelText('Cluster threshold, absolute value');
    expect(threshold).toBeDisabled();
    expect(threshold).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Min')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Cluster p (RFT)' })).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    const compute = screen.getByRole('button', { name: 'Compute' });
    expect(compute).toBeDisabled();
    expect(screen.getByTestId('cluster-reason')).toHaveTextContent('Clusters need a statistical layer (a z, t or F map)');
    expect(compute).toHaveAttribute('aria-describedby', 'cluster-reason');
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
    // Treegrid (v1 function 2, deliberate): arrows move focus only; Enter selects.
    act(() => row1.focus());
    selectCluster.mockClear();
    fireEvent.keyDown(row1, { key: 'ArrowDown' });
    expect(selectCluster).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('cluster-row-2'));
    fireEvent.keyDown(screen.getByTestId('cluster-row-2'), { key: 'Enter' });
    expect(selectCluster).toHaveBeenLastCalledWith(2);
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent(
      '26-connected clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 2 clusters, 30 voxels.',
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
    // Deliberate change (v1 function 2): named as another layer's table, still usable.
    expect(screen.getByTestId('cluster-elsewhere')).toHaveTextContent('Table for zmap_synthetic');
    // Headed by the table's statistic (z), not the active layer's (t).
    expect(screen.getByRole('columnheader', { name: /^Peak z/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Peak t/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy CSV' })).toBeEnabled();
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

  it('"Series for cluster" stays focusable when unavailable and says why in visible text (v1 function 2)', () => {
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: TABLE, regions: [null, null], computedAt: 0 });
    render(<ClusterPanel />);
    const series = screen.getByTestId('cluster-series');
    expect(series).not.toBeDisabled();
    expect(series).toHaveAttribute('aria-disabled', 'true');
    expect(series).toHaveAttribute('aria-describedby', 'cluster-series-reason');
    expect(screen.getByTestId('cluster-series-reason')).toHaveTextContent('Select a cluster row.');
    fireEvent.click(series);
  });

  it('a brain mask bounds the search: sent as searchMask, part of staleness, named in the methods (S3)', () => {
    useLayerStore.setState((st) => ({
      layers: [...st.layers, { id: 'mask', name: 'brain_mask.nii.gz', volumeId: 'vol-mask', type: 'volume', visible: true, order: 2 } as never],
    }));
    render(<ClusterPanel />);
    const search = screen.getByLabelText('Search');
    // Only masks are offered (round 3 T2): the T1 would search its own non-zero support.
    // Deliberate change (final batch, v4 fidelity 2): a mask may be a small ROI, so
    // it is "Mask <name>", never "brain mask", under "Restrict to a mask".
    expect(Array.from((search as HTMLSelectElement).options).map((o) => o.text)).toEqual([
      'Non-zero voxels of the map',
      'Mask brain_mask',
    ]);
    expect(search.querySelector('optgroup')).toHaveAttribute('label', 'Restrict to a mask');
    fireEvent.change(search, { target: { value: 'mask' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(compute).toHaveBeenLastCalledWith(expect.objectContaining({ searchMask: 'vol-mask' }));
    act(() =>
      useClusterStore.getState().setResult({
        layerId: 'z',
        layerName: 'zmap_synthetic.nii.gz',
        table: { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 2000 } },
        regions: [null, null],
        computedAt: 0,
      }),
    );
    expect(screen.queryByTestId('cluster-stale')).toBeNull();
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent('search volume 2,000 voxels (restricted to mask brain_mask)');
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByTestId('cluster-stale')).toHaveTextContent('Parameters changed since this table.');
  });

  it('removing the chosen mask resets the choice visibly and marks its table stale (round 3 T2)', () => {
    useLayerStore.setState((st) => ({
      layers: [...st.layers, { id: 'mask', name: 'brain_mask.nii.gz', volumeId: 'vol-mask', type: 'volume', visible: true, order: 2 } as never],
    }));
    render(<ClusterPanel />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mask' } });
    act(() =>
      useClusterStore.getState().setResult({
        layerId: 'z',
        layerName: 'zmap_synthetic.nii.gz',
        table: { ...TABLE, searchVolume: { kind: 'mask', maskVolumeId: 'vol-mask', voxels: 2000 } },
        regions: [null, null],
        // As compute captures it.
        maskName: 'brain_mask.nii.gz',
        computedAt: 0,
      }),
    );
    expect(screen.queryByTestId('cluster-stale')).toBeNull();
    act(() => useLayerStore.setState((st) => ({ layers: st.layers.filter((l) => l.id !== 'mask') })));
    expect(useClusterStore.getState().params.searchMaskLayerId).toBeNull();
    expect(screen.getByTestId('cluster-stale')).toHaveTextContent('The search mask of this table was removed.');
    // Round 4 C5: the control stays, disabled, with a hint; the stale notice is said once
    // and the methods sentence that explains the shown values stays, marked stale.
    expect(screen.getByLabelText('Search')).toBeDisabled();
    expect(screen.getByTestId('cluster-search-hint')).toHaveTextContent('No mask loaded');
    expect(screen.getAllByText(/The search mask of this table was removed\./)).toHaveLength(1);
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent('(Stale)');
    // v4 function 3: the stale methods name the mask captured at compute time, not its volume id.
    expect(screen.getByTestId('cluster-methods')).toHaveTextContent('restricted to mask brain_mask');
    expect(screen.getByTestId('cluster-methods')).not.toHaveTextContent('vol-mask');
  });

  it('a chosen mask whose metadata is still loading keeps the choice (review m16)', () => {
    useLayerStore.setState((st) => ({
      layers: [...st.layers, { id: 'mask', name: 'brain_mask.nii.gz', volumeId: 'vol-mask', type: 'volume', visible: true, order: 2 } as never],
    }));
    render(<ClusterPanel />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mask' } });
    // A reload re-adds the layer under a name that is not yet recognised as a mask.
    act(() =>
      useLayerStore.setState((st) => ({
        layers: st.layers.map((l) => (l.id === 'mask' ? ({ ...l, name: 'loading' } as never) : l)),
      })),
    );
    expect(useClusterStore.getState().params.searchMaskLayerId).toBe('mask');
  });

  it('the RFT checkbox and FWHM wrap as one group (v4 visual 3)', () => {
    useClusterStore.getState().setParams({ extentP: true });
    render(<ClusterPanel />);
    const group = screen.getByTestId('cluster-rft-group');
    expect(group).toHaveClass('whitespace-nowrap');
    expect(group).toContainElement(screen.getByLabelText('FWHM'));
  });

  it('the Search control is shown, disabled with a hint, when no brain mask is loaded (round 4 C5)', () => {
    render(<ClusterPanel />);
    const search = screen.getByLabelText('Search');
    expect(search).toBeDisabled();
    expect(search).toHaveValue('');
    expect(screen.getByTestId('cluster-search-hint')).toHaveTextContent('No mask loaded');
  });

  it('cluster p withheld on a pre-thresholded map: the p columns say so and the methods give the reason (B12)', () => {
    const reason =
      'This map looks pre-thresholded (no |z| < 3.1 among non-zero voxels); cluster p needs the unthresholded map or a search mask.';
    useClusterStore.getState().setParams({ extentP: true, fwhmText: '8' });
    useClusterStore.getState().setResult({
      layerId: 'z',
      layerName: 'zmap_synthetic.nii.gz',
      table: {
        ...TABLE,
        extentInference: null,
        clusters: TABLE.clusters.map((c) => ({ ...c, pFweExtent: null, pUncorrectedExtent: null })),
        extentWithheld: { code: 4080, reason },
      },
      regions: [null, null],
      computedAt: 1,
    } as never);
    render(<ClusterPanel />);
    const cell = screen.getByTestId('cluster-pfwe-1');
    expect(cell).toHaveTextContent('withheld');
    expect(cell).toHaveAttribute('title', reason);
    expect(screen.getByTestId('cluster-p-withheld')).toHaveTextContent(`Cluster p withheld: ${reason} Choose a brain mask under Search`);
    // Not stale: the table answers the request (cluster p was asked for).
    expect(screen.queryByTestId('cluster-stale')).toBeNull();
  });

  it('arrow keys the table handles never reach window shortcuts (v1 function 6)', () => {
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: TABLE, regions: [null, null], computedAt: 0 });
    render(<ClusterPanel />);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const row = screen.getByTestId('cluster-row-1');
    act(() => row.focus());
    // Not cancelable, like a synthetic event: preventDefault alone does nothing.
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(screen.getByTestId('cluster-row-2'));
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });
});
