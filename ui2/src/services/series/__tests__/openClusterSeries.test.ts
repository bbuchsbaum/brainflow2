import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { DEFAULT_SERIES_SETTINGS, useSeriesStore } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { firSet } from '@/devHarness/app/firStudy';
import { clusterSeriesUnavailable, openClusterSeries } from '../openClusterSeries';
import { selectedClusterRegion } from '../seriesRegion';

const table = (labelVolumeId?: string) =>
  ({ clusters: [{ id: 1 }], threshold: 3.1, labelVolumeId }) as never;

describe('Series for this cluster (E3)', () => {
  beforeEach(() => {
    useSeriesStore.setState({ ...DEFAULT_SERIES_SETTINGS });
    useClusterStore.getState().reset();
    useLayerStore.setState({ layers: [], selectedLayerId: null } as never);
    useSetStudioStore.setState({ sets: {}, selection: { ...useSetStudioStore.getState().selection, activeSetId: null } });
  });

  it('says why it is unavailable: no row, no label volume, no series source', () => {
    expect(clusterSeriesUnavailable()).toMatch(/Select a cluster row/);
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap', table: table(), regions: [], computedAt: 0 });
    useClusterStore.getState().select(1);
    expect(clusterSeriesUnavailable()).toMatch(/Compute the table again/);
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap', table: table('labels-1'), regions: [], computedAt: 0 });
    useClusterStore.getState().select(1);
    expect(clusterSeriesUnavailable()).toMatch(/lag or time axis, or a 4D layer/);
  });

  it('with a dataset: cluster locus, dataset source, the Plot dock in Series mode', () => {
    useSetStudioStore.getState().bootstrapStudio({ set: firSet('3d'), features: [{ id: 'fir', label: 'FIR', kind: 'volume' }], cohorts: [], expressions: [] } as never);
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap_synthetic.nii.gz', table: table('labels-1'), regions: [], computedAt: 0 });
    useClusterStore.getState().select(1);
    expect(clusterSeriesUnavailable()).toBeNull();
    openClusterSeries();
    expect(useSeriesStore.getState()).toMatchObject({ locus: 'cluster', source: 'set' });
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('plot');
    expect(usePlotModeStore.getState().activePlotModeId).toBe('crosshair-time-series');
    expect(selectedClusterRegion()).toEqual({
      region: { labelSource: { type: 'volume', volumeId: 'labels-1' }, labelIds: [1] },
      label: 'cluster 1 of zmap_synthetic',
    });
  });

  it('without a dataset: selects the loaded 4D layer', () => {
    useLayerStore.setState({
      layers: [
        { id: 'z', name: 'zmap', volumeId: 'z', type: 'volume', visible: true, order: 0 },
        { id: 'bold', name: 'bold', volumeId: 'b', type: 'volume', visible: true, order: 1, timeSeriesInfo: { num_timepoints: 8 } },
      ],
      selectedLayerId: 'z',
    } as never);
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap', table: table('labels-1'), regions: [], computedAt: 0 });
    useClusterStore.getState().select(1);
    openClusterSeries();
    expect(useSeriesStore.getState()).toMatchObject({ locus: 'cluster', source: 'layer' });
    expect(useLayerStore.getState().selectedLayerId).toBe('bold');
  });

  it('keeps keyboard focus: moves it to the Series plot once it shows values (round 3 S3)', async () => {
    useSetStudioStore.getState().bootstrapStudio({ set: firSet('3d'), features: [{ id: 'fir', label: 'FIR', kind: 'volume' }], cohorts: [], expressions: [] } as never);
    useClusterStore.getState().setResult({ layerId: 'z', layerName: 'zmap', table: table('labels-1'), regions: [], computedAt: 0 });
    useClusterStore.getState().select(1);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    openClusterSeries();
    // The plot mounts and samples later: its values' tab stop takes focus.
    const plot = document.createElement('div');
    plot.setAttribute('data-testid', 'set-series-plot');
    plot.innerHTML = '<svg><circle data-datum-id="r0" tabindex="0"></circle></svg>';
    document.body.appendChild(plot);
    await vi.waitFor(() => expect(document.activeElement).toBe(plot.querySelector('[data-datum-id]')));
    plot.remove();
    button.remove();
  });
});
