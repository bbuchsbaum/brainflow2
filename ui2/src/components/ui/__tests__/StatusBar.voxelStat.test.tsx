import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));
vi.mock('@/hooks/useLayerValueAtWorld', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useLayerValueAtWorld')>()),
  useLayerValueAtWorld: (layerId: string | null) => (layerId ? { value: 6.76 } : null),
}));

import { StatusBar } from '../StatusBar';
import { formatVoxelIndex } from '@/utils/voxelSnap';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';

const MNI_V2W = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -95.5, -131.5, -77.5, 1];
const MNI_W2V = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 47.75, 65.75, 38.75, 1];
const T24 = {
  kind: 't' as const,
  intentCode: 3,
  intentParams: [24, 0, 0] as [number, number, number],
  intentName: 't-stat',
  dof: [24],
  label: 't(24)',
  fromDescription: false,
  positiveDataLabel: null,
};

function seed(crosshair: [number, number, number], withStatistic = true) {
  useLayerStore.setState({
    layers: [
      { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true, order: 0 },
      {
        id: 'tmap',
        name: 'tmap',
        volumeId: 'tmap',
        type: 'volume',
        visible: true,
        order: 1,
        statistic: withStatistic ? T24 : undefined,
      },
    ] as never,
    selectedLayerId: 'tmap',
    layerMetadata: new Map([
      ['t1', { voxelToWorld: MNI_V2W, worldToVoxel: MNI_W2V, dimensions: [96, 114, 96] as [number, number, number] }],
      ['tmap', { dataRange: { min: -5.674, max: 6.76 } }],
    ]),
  });
  useStatusReadoutStore.setState({ override: null } as never);
  useViewStateStore.getState().setViewState((state) => {
    state.crosshair.world_mm = crosshair;
    state.layers = ['t1', 'tmap'].map((id) => ({
      id,
      name: id,
      volumeId: id,
      visible: true,
      opacity: 1,
      colormap: 'gray',
      intensity: [0, 1] as [number, number],
      threshold: [0, 0] as [number, number],
      blendMode: 'alpha' as const,
      interpolation: 'linear' as const,
    }));
  });
}

const slotText = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-slot="${id}"] .status-value`)?.textContent ?? null;

describe('StatusBar voxel and statistic readouts', () => {
  beforeEach(() => useViewStateStore.getState().resetToDefaults());

  it('formats a voxel index', () => {
    expect(formatVoxelIndex([69, 36, 34])).toBe('69, 36, 34');
    expect(formatVoxelIndex([47.5, -0.04, 3.25], 1)).toBe('47.5, 0.0, 3.3');
    expect(formatVoxelIndex([-2, 0, 1])).toBe('\u22122, 0, 1');
  });

  it('falls back to the bottom layer grid when the selected layer has no affine, still naming the layer', () => {
    seed([42.5, -59.5, -9.5]);
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'voxel')).toBe('ijk 69, 36, 34 (tmap, reference grid)');
  });

  it('names the reported layer even with no voxel grid at all', () => {
    seed([42.5, -59.5, -9.5]);
    useLayerStore.setState({ layerMetadata: new Map([['tmap', { dataRange: { min: -5.674, max: 6.76 } }]]) as never });
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'voxel')).toBe('ijk — (tmap)');
  });

  it('shows "—" outside the grid and still names it', () => {
    seed([500, 0, 0]);
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'voxel')).toBe('ijk — (tmap, reference grid)');
  });

  it('labels the value with the statistic of a statistic map', () => {
    seed([42.5, -59.5, -9.5]);
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'value')).toBe('t(24) 6.76');
    expect(container.querySelector('[data-slot="value"] i')).toHaveTextContent('t');
  });

  it('keeps a plain value for images without a statistic', () => {
    seed([42.5, -59.5, -9.5], false);
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'value')).toBe('6.76');
  });

  it('shows fractional ijk in the warning token when snapping is off and between centres', async () => {
    const { useCrosshairSettingsStore, DEFAULT_SETTINGS } = await import('@/stores/crosshairSettingsStore');
    useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, snapToVoxel: false } });
    try {
      seed([-0.5, -18.5, 17.5]);
      const { container } = render(<StatusBar />);
      expect(slotText(container, 'voxel')).toBe('ijk 47.5, 56.5, 47.5 (tmap, reference grid)');
      expect(container.querySelector('[data-slot="voxel"] .status-value')).toHaveClass('status-value--warning');
    } finally {
      useCrosshairSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    }
  });

  it('hides the Region slot without an atlas or label layer, and shows a swatch with one', async () => {
    const { useStatusBarStore } = await import('@/stores/statusBarStore');
    seed([42.5, -59.5, -9.5]);
    useStatusBarStore.getState().setValue('region', 'R_occipitotemporal');
    useStatusBarStore.getState().setValue('regionColor', 'rgb(220, 180, 60)');
    const first = render(<StatusBar />);
    expect(first.container.querySelector('[data-slot="region"]')).toBeNull();
    first.unmount();
    useLayerStore.setState((state) => ({
      layers: [
        ...state.layers,
        {
          id: 'dseg',
          name: 'atlas-synth3_dseg.nii.gz',
          volumeId: 'dseg',
          type: 'label',
          visible: true,
          order: 2,
          atlasPaletteLegend: [{ label_id: 2, roi: 'R_occipitotemporal', color: [220, 180, 60] }],
        } as never,
      ],
    }));
    const { container } = render(<StatusBar />);
    expect(slotText(container, 'region')).toBe('R_occipitotemporal');
    expect(container.querySelector('[data-testid="status-region-swatch"]')).toHaveStyle({
      background: 'rgb(220, 180, 60)',
    });
  });
});
