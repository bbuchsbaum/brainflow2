import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SurfaceFrame } from '../SurfaceFrame';
import { surfaceColorbarLayer } from '../surfaceColorbar';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';

function surface(withOverlay: boolean): LoadedSurface {
  const layers = new Map();
  if (withOverlay) {
    layers.set('ov', {
      id: 'ov',
      name: 'lh.sensorimotor.func.gii',
      values: new Float32Array([0, 1, 2]),
      colormap: 'viridis',
      range: [0, 2],
      dataRange: [0, 2],
      opacity: 1,
      visible: true,
    });
  }
  return {
    handle: 's1',
    name: 'lh.inflated.gii',
    visible: true,
    geometry: { vertices: new Float32Array(), faces: new Uint32Array() },
    layers,
    metadata: { vertexCount: 32492, faceCount: 64980, hemisphere: 'left', surfaceType: 'inflated', path: '/x/lh.inflated.gii' },
  } as unknown as LoadedSurface;
}

describe('SurfaceFrame (P3.10)', () => {
  it('heads the pane like a slice frame and discloses the mesh counts', () => {
    render(<SurfaceFrame surface={surface(true)} width={600} height={400} />);
    const header = screen.getByTestId('surface-frame-header');
    expect(header).toHaveTextContent('Surface · left · inflated');
    expect(header).toHaveTextContent('lh.sensorimotor.func');
    const counts = screen.getByTestId('surface-frame-counts');
    expect(counts).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(counts);
    expect(header).toHaveTextContent('64,980');
  });

  it('camera presets set the viewpoint', () => {
    render(<SurfaceFrame surface={surface(false)} width={600} height={400} />);
    fireEvent.click(screen.getByRole('radio', { name: 'M' }));
    expect(useSurfaceStore.getState().viewpoint).toBe('medial');
  });

  it('describes the visible scalar overlay in the colorbar, none without one', () => {
    expect(surfaceColorbarLayer(surface(true))).toMatchObject({ colormap: 'viridis', intensity: [0, 2] });
    expect(surfaceColorbarLayer(surface(false))).toBeNull();
  });
});
