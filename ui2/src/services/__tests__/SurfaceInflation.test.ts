import { beforeEach, describe, expect, it } from 'vitest';
import { inflateSurface, inflationIterations } from '@brainflow/visualization/surface';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { SurfaceInflationService } from '../SurfaceInflationService';

/** A rippled sphere: an octahedron subdivided `levels` times, folds along longitude. */
function rippled(levels = 4): { vertices: Float32Array; faces: Uint32Array } {
  let verts: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let faces: number[][] = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let level = 0; level < levels; level++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(key)) return cache.get(key)!;
      const p = verts[a].map((x, i) => (x + verts[b][i]) / 2);
      const len = Math.hypot(...p);
      verts.push(p.map((x) => x / len));
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  verts = verts.map(([x, y, z]) => {
    const r = 40 * (1 + 0.1 * Math.sin(10 * Math.atan2(y, x)));
    return [x * r, y * r, z * r];
  });
  return { vertices: Float32Array.from(verts.flat()), faces: Uint32Array.from(faces.flat()) };
}

function radialSpread(vertices: Float32Array): number {
  const n = vertices.length / 3;
  const c = [0, 0, 0];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) c[k] += vertices[3 * v + k] / n;
  const r: number[] = [];
  for (let v = 0; v < n; v++) r.push(Math.hypot(vertices[3 * v] - c[0], vertices[3 * v + 1] - c[1], vertices[3 * v + 2] - c[2]));
  const mean = r.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / n) / mean;
}

describe('inflateSurface', () => {
  it('smooths the folds out, keeps the vertex numbering and roughly the size', () => {
    const mesh = rippled();
    const inflated = inflateSurface(mesh.vertices, mesh.faces, { foldScaleMm: 20 });
    expect(inflated.length).toBe(mesh.vertices.length);
    expect(radialSpread(inflated)).toBeLessThan(radialSpread(mesh.vertices) / 3);
    const extent = (v: Float32Array) => Math.max(...v) - Math.min(...v);
    expect(extent(inflated) / extent(mesh.vertices)).toBeGreaterThan(0.8);
    expect(extent(inflated) / extent(mesh.vertices)).toBeLessThan(1.2);
  });

  it('scales the iteration count with the mesh resolution', () => {
    const coarse = rippled(2);
    const fine = rippled(4);
    const options = { foldScaleMm: 30, minIterations: 1, maxIterations: 10_000 };
    const nFine = inflationIterations(fine.vertices, fine.faces, options);
    const nCoarse = inflationIterations(coarse.vertices, coarse.faces, options);
    // Edges halve per subdivision level: about 4x the steps per level.
    expect(nFine / nCoarse).toBeGreaterThan(8);
  });
});

describe('SurfaceInflationService', () => {
  beforeEach(() => useSurfaceStore.setState({ surfaces: new Map() }));

  it('stores the inflated embedding on the folded mesh, once', async () => {
    const mesh = rippled(3);
    const white: LoadedSurface = {
      handle: 'w',
      name: 'fsaverage white (left)',
      visible: true,
      geometry: { ...mesh, hemisphere: 'left', surfaceType: 'white' },
      layers: new Map(),
      metadata: { vertexCount: mesh.vertices.length / 3, faceCount: mesh.faces.length / 3, path: 'templateflow://fsaverage_white_left' },
    };
    useSurfaceStore.setState({ surfaces: new Map([['w', white]]) });
    const service = new SurfaceInflationService();
    const [a, b] = await Promise.all([service.ensureInflated('w'), service.ensureInflated('w')]);
    expect(a && b).toBe(true);
    const inflated = useSurfaceStore.getState().surfaces.get('w')!.computedVariants?.inflated;
    expect(inflated?.length).toBe(mesh.vertices.length);
    expect(await service.ensureInflated('w')).toBe(true);
    expect(useSurfaceStore.getState().surfaces.get('w')!.computedVariants?.inflated).toBe(inflated);
  });
});
