import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { buildSceneStack } from '@/hooks/useSceneStack';
import { InspectorRouter } from '../InspectorRouter';
vi.mock('@/services/AtlasRoiService', () => ({
  atlasRoiService: { locations: vi.fn().mockResolvedValue([]), focus: vi.fn() },
}));
vi.mock('@/hooks/useDisplayMode', () => ({ useDisplayMode: () => ({ mode: 'integrated' }) }));
vi.mock('../imaging/InspectorLoadDialogs', () => ({
  AtlasPicker: () => null,
  ProjectionPicker: () => null,
}));
vi.mock('../imaging/sections/DataSection', () => ({ DataSection: () => null }));
vi.mock('@/components/ui/ColormapPicker', () => ({
  ColormapPicker: () => <div>Continuous colormap</div>,
}));

beforeEach(() => {
  useLayerStore.setState({
    layers: [
      {
        id: 'atlas',
        volumeId: 'atlas',
        name: 'Schaefer 400',
        type: 'label',
        visible: true,
        order: 0,
      },
    ],
    layerMetadata: new Map(),
  });
  useViewStateStore.getState().setViewState((s) => {
    s.layers = [
      {
        id: 'atlas',
        volumeId: 'atlas',
        name: 'Schaefer 400',
        visible: true,
        opacity: 1,
        intensity: [0, 400],
        threshold: [0, 0],
        colormap: 'categorical',
        layerMode: 'label',
        atlasConfig: {
          atlas_id: 'schaefer',
          space: 'MNI152NLin6Asym',
          resolution: '1mm',
          parcels: 400,
          networks: 7,
        },
      },
    ];
  });
  useSurfaceStore.setState({ surfaces: new Map() });
  const item = buildSceneStack(useLayerStore.getState().layers, new Map(), null).volumes[0];
  expect(item.kind).toBe('volume-base'); // This is the user's screenshot, not the older inspector.
  useInspectorSelectionStore.getState().setActive(item);
});

describe('active Inspector parcel workflow', () => {
  it('opens the actual import form for a base atlas through InspectorRouter', async () => {
    render(<InspectorRouter />);
    fireEvent.click(screen.getByRole('button', { name: 'Add parcel values…' }));
    expect(screen.getByLabelText('CSV or TSV file')).toBeInTheDocument();
    expect(screen.getByText(/^Target:/)).toHaveTextContent('Target: Schaefer 400');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search ROIs by name or ID' })).toBeEnabled(),
    );
  });
  it('offers the same workflow on a loaded surface parcellation', () => {
    useSurfaceStore
      .getState()
      .addSurface({
        handle: 'lh',
        name: 'Left cortex',
        visible: true,
        geometry: { vertices: new Float32Array([0, 0, 0, 1, 0, 0]), faces: new Uint32Array() },
        layers: new Map(),
        metadata: { vertexCount: 2, faceCount: 0, path: 'test' },
      });
    useSurfaceStore
      .getState()
      .addDataLayer('lh', {
        id: 'labels',
        name: 'Schaefer surface',
        labels: new Uint32Array([1, 2]),
        values: new Float32Array([1, 2]),
        parcelDictionaryId: 'dictionary',
        colormap: 'categorical',
        range: [0, 2],
        dataRange: [0, 2],
        opacity: 1,
      });
    const item = buildSceneStack([], useSurfaceStore.getState().surfaces, null).surfaces.find(
      (i) => i.ref.type === 'surface-overlay',
    )!;
    useInspectorSelectionStore.getState().setActive(item);
    render(<InspectorRouter />);
    fireEvent.click(screen.getByRole('button', { name: 'Add parcel values…' }));
    expect(screen.getByLabelText('CSV or TSV file')).toBeInTheDocument();
    expect(screen.getByText(/both hemispheres when present/)).toBeInTheDocument();
  });
});
