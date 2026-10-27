import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../TimeSlider', () => ({ TimeSlider: () => null }));
vi.mock('../StatusBarProgress', () => ({ StatusBarProgress: () => null }));

import { StatusBar } from '../StatusBar';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { buildSurfaceViewContextId } from '@/utils/surfaceViewContext';

const FACES = new Uint32Array([0, 1, 2]);
function mesh(handle: string, type: string, vertices: number[], overlay: boolean): LoadedSurface {
  return {
    handle,
    name: `lh.${type}.gii`,
    visible: true,
    geometry: { vertices: new Float32Array(vertices), faces: FACES, hemisphere: 'left', surfaceType: type as never },
    layers: overlay
      ? new Map([
          ['ov', { id: 'ov', name: 'lh.sensorimotor.func.gii', visible: true, values: new Float32Array([0.5, 2.25, 9]), colormap: 'viridis', range: [0, 9], dataRange: [0, 9] } as never],
        ])
      : new Map(),
    metadata: { vertexCount: 3, faceCount: 1, hemisphere: 'left', surfaceType: type, path: `/s/lh.${type}.gii` },
  } as LoadedSurface;
}

describe('StatusBar Vertex slot (phase 4, D1)', () => {
  beforeEach(() => {
    useViewStateStore.getState().resetToDefaults();
    void useViewStateStore.getState().setCrosshair([10, 0, 0]);
    useActiveRenderContextStore.setState({ activeId: buildSurfaceViewContextId('infl', 'surface-view') });
  });

  it('shows the anatomical vertex and the overlay value while a surface pane is active', () => {
    useSurfaceStore.setState({
      surfaces: new Map([
        ['infl', mesh('infl', 'inflated', [50, 0, 0, 60, 0, 0, 70, 0, 0], true)],
        ['pial', mesh('pial', 'pial', [0, 0, 0, 10.5, 0, 0, 30, 0, 0], false)],
      ]),
    });
    render(<StatusBar />);
    // The value is labelled with its overlay (v1 function 9; was "1 2.25").
    const slot = screen.getByTestId('status-vertex');
    expect(slot).toHaveTextContent('1 · sensorimotor.func 2.25');
    expect(slot).toHaveAttribute('aria-label', 'Vertex 1, sensorimotor.func 2.25');
    expect(slot.closest('[title]')?.getAttribute('title')).toMatch(/^Vertex 1, 0\.5 mm from the crosshair; lh\.sensorimotor\.func\.gii = 2\.25$/);
  });

  it('an inflated mesh alone: "—", saying what to load', () => {
    useSurfaceStore.setState({ pickedVertex: null, surfaces: new Map([['infl', mesh('infl', 'inflated', [0, 0, 0, 10, 0, 0, 0, 10, 0], true)]]) });
    render(<StatusBar />);
    const slot = screen.getByTestId('status-vertex');
    expect(slot).toHaveTextContent('—');
    expect(slot.closest('[title]')).toHaveAttribute('title', 'Load the matching pial or white surface for an anatomical readout');
  });

  it('an inflated mesh alone: a vertex clicked on it is shown with its value (native check item 9)', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['infl', mesh('infl', 'inflated', [0, 0, 0, 10, 0, 0, 0, 10, 0], true)]]),
      pickedVertex: { surfaceId: 'infl', vertex: 2, world: [10, 0, 0] },
    });
    render(<StatusBar />);
    const slot = screen.getByTestId('status-vertex');
    expect(slot).toHaveTextContent('2 · sensorimotor.func 9');
    expect(slot.closest('[title]')?.getAttribute('title')).toMatch(/^Vertex 2, clicked on the surface/);
  });

  it('a click elsewhere since (the crosshair moved in a volume) falls back to the crosshair lookup', () => {
    useSurfaceStore.setState({
      surfaces: new Map([['infl', mesh('infl', 'inflated', [0, 0, 0, 10, 0, 0, 0, 10, 0], true)]]),
      pickedVertex: { surfaceId: 'infl', vertex: 2, world: [99, 0, 0] },
    });
    render(<StatusBar />);
    expect(screen.getByTestId('status-vertex')).toHaveTextContent('—');
  });

  it('hidden while a volume pane is active', () => {
    useActiveRenderContextStore.setState({ activeId: 'axial' });
    render(<StatusBar />);
    expect(screen.queryByTestId('status-vertex')).toBeNull();
  });
});
