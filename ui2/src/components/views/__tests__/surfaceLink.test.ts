import { describe, expect, it } from 'vitest';
import { resolveCursorAnatomy } from '../surfaceLink';
import {
  findLinkedVertex,
  mapPickedTriangle,
} from '../../../../../packages/visualization/src/surface/linkedCursor';
import type { LoadedSurface } from '@/stores/surfaceStore';

function surface(type: 'pial' | 'inflated', vertices: number[], subject = 'sub-01'): LoadedSurface {
  return {
    handle: `${subject}-${type}`,
    visible: true,
    name: type,
    layers: new Map(),
    geometry: {
      vertices: new Float32Array(vertices),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere: 'left',
      surfaceType: type,
    },
    metadata: { vertexCount: 3, faceCount: 1, path: `/data/${subject}/lh.${type}.surf.gii` },
  };
}
const anatomy = [-30, 10, 20, -26, 10, 20, -30, 14, 20];
const inflated = [-100, 0, 0, -80, 0, 0, -100, 20, 0];

describe('anatomical cursor correspondence', () => {
  it('uses anatomical nearest vertex and displays the matching inflated vertex', () => {
    const pial = surface('pial', anatomy),
      display = surface('inflated', inflated);
    const references = resolveCursorAnatomy([display], [pial, display]);
    const result = findLinkedVertex([display], [-26, 10, 20], references);
    expect(result).toEqual({
      handle: display.handle,
      index: 1,
      position: [-80, 0, 0],
      distanceMm: 0,
    });
  });

  it('maps an interior inflated triangle pick back to an asymmetric anatomical location', () => {
    const point = mapPickedTriangle(
      new Float32Array(anatomy),
      [0, 1, 2],
      [
        [-100, 0, 0],
        [-80, 0, 0],
        [-100, 20, 0],
      ],
      [-95, 10, 0],
    );
    // Barycentric weights are (1/4, 1/4, 1/2), independent of displayed geometry.
    expect(point).toEqual([-29, 12, 20]);
  });

  it('does not link missing, other-subject, or mismatched-topology reference geometry', () => {
    const display = surface('inflated', inflated);
    const other = surface('pial', anatomy, 'sub-02');
    expect(resolveCursorAnatomy([display], [other]).size).toBe(0);
    const wrong = surface('pial', anatomy);
    wrong.geometry.faces = new Uint32Array([2, 1, 0]);
    expect(resolveCursorAnatomy([display], [wrong]).size).toBe(0);
    expect(findLinkedVertex([display], [0, 0, 0], new Map())).toBeNull();
  });

  it('rejects hidden geometry, invalid coordinates, and degenerate picked triangles', () => {
    const pial = surface('pial', anatomy);
    pial.visible = false;
    expect(findLinkedVertex([pial], [-30, 10, 20])).toBeNull();
    expect(findLinkedVertex([pial], [NaN, 0, 0])).toBeNull();
    expect(
      mapPickedTriangle(
        new Float32Array(anatomy),
        [0, 1, 2],
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
        [1, 0, 0],
      ),
    ).toBeNull();
  });
});
