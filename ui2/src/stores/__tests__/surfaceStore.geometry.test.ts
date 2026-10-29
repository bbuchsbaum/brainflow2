import { describe, expect, it } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';

const template: LoadedSurface = {
  handle: 'surface_template_fsaverage_pial_L',
  name: 'fsaverage pial (left)',
  visible: true,
  geometry: {
    vertices: new Float32Array(0),
    faces: new Uint32Array(0),
    hemisphere: 'left',
    surfaceType: 'pial',
  },
  layers: new Map(),
  metadata: { vertexCount: 3, faceCount: 1, hemisphere: 'left', surfaceType: 'pial' },
};

describe('surfaceStore.setSurfaceGeometry', () => {
  it('keeps hemisphere and surface type when vertices/faces arrive later', () => {
    useSurfaceStore.setState({ surfaces: new Map() });
    useSurfaceStore.getState().addSurface(template, false);
    useSurfaceStore.getState().setSurfaceGeometry(template.handle, {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faces: new Uint32Array([0, 1, 2]),
    });
    const geometry = useSurfaceStore.getState().surfaces.get(template.handle)!.geometry;
    expect(geometry.vertices).toHaveLength(9);
    // Camera presets resolve "<hemisphere>_<preset>"; losing this made every
    // preset render the same fallback pose.
    expect(geometry.hemisphere).toBe('left');
    expect(geometry.surfaceType).toBe('pial');
  });
});
