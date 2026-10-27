import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { buildSceneStack } from '@/hooks/useSceneStack';
import { InspectorRouter } from '../InspectorRouter';

vi.mock('@/hooks/useDisplayMode', () => ({ useDisplayMode: () => ({ mode: 'integrated' }) }));
vi.mock('../imaging/InspectorLoadDialogs', () => ({ AtlasPicker: () => null, ProjectionPicker: () => null }));
vi.mock('../imaging/sections/DataSection', () => ({ DataSection: () => null }));
vi.mock('@/components/ui/ColormapPicker', () => ({ ColormapPicker: () => <div>Continuous colormap</div> }));

// Native check item 8: a continuous surface overlay had no Threshold control.
describe('continuous surface overlay render rows', () => {
  it('offers Intensity and a Threshold that hides values within it, like a volume', () => {
    useSurfaceStore.getState().addSurface({
      handle: 'lh',
      name: 'lh.inflated.gii',
      visible: true,
      geometry: { vertices: new Float32Array([0, 0, 0, 1, 0, 0]), faces: new Uint32Array() },
      layers: new Map(),
      metadata: { vertexCount: 2, faceCount: 0, path: 'lh.inflated.gii' },
    } as never);
    useSurfaceStore.getState().addDataLayer('lh', {
      id: 'func',
      name: 'lh.sensorimotor.func.gii',
      values: new Float32Array([100, 50000]),
      colormap: 'viridis',
      range: [0, 59412],
      dataRange: [0, 59412],
      threshold: [0, 27000],
      opacity: 1,
    });
    const item = buildSceneStack([], useSurfaceStore.getState().surfaces, null).surfaces.find(
      (i) => i.ref.type === 'surface-overlay',
    )!;
    useInspectorSelectionStore.getState().setActive(item);
    render(<InspectorRouter />);
    expect(screen.getAllByText('Threshold').length).toBeGreaterThan(0);
    // The hidden-range wording, as for a volume ("0 ≤ value ≤ 27,000 hidden").
    expect(document.body.textContent).toMatch(/27,?000\s*hidden/);
    expect(screen.getByRole('button', { name: 'Clear threshold' })).toBeInTheDocument();
  });
});
