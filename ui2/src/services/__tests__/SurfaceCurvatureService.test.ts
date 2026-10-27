import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../transport', () => ({ getTransport: () => ({ invoke }) }));

import { SurfaceCurvatureService } from '../SurfaceCurvatureService';

/** An icosphere-like folded test mesh: an octahedron subdivided twice, with bumps. */
function foldedMesh(): { vertices: Float32Array; faces: Uint32Array } {
  let verts: number[][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let faces: number[][] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  for (let level = 0; level < 3; level += 1) {
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
  // Folds: a radial ripple.
  verts = verts.map(([x, y, z]) => {
    const r = 50 * (1 + 0.08 * Math.sin(6 * Math.atan2(y, x)) * Math.cos(4 * z));
    return [x * r, y * r, z * r];
  });
  return { vertices: Float32Array.from(verts.flat()), faces: Uint32Array.from(faces.flat()) };
}

function surface(handle: string, type: string, path: string, mesh: { vertices: Float32Array; faces: Uint32Array }): LoadedSurface {
  return {
    handle,
    name: path.split('/').pop()!,
    visible: true,
    geometry: { vertices: mesh.vertices, faces: mesh.faces, hemisphere: 'left', surfaceType: type as never },
    layers: new Map(),
    metadata: { vertexCount: mesh.vertices.length / 3, faceCount: mesh.faces.length / 3, hemisphere: 'left', surfaceType: type, path },
  };
}

describe('SurfaceCurvatureService (D2: underlay sources)', () => {
  beforeEach(() => {
    invoke.mockReset();
    useSurfaceStore.setState({ surfaces: new Map() });
  });

  it('a sulc shape file next to the mesh wins', async () => {
    const mesh = foldedMesh();
    const n = mesh.vertices.length / 3;
    invoke.mockImplementation(async (cmd: string, args: { path?: string }) => {
      if (cmd === 'fs_list_directory') {
        expect(args.path).toBe('/d');
        return {
          nodes: ['lh.inflated.gii', 'lh.sulc.shape.gii', 'lh.curv'].map((name) => ({ id: `/d/${name}`, name, isDir: false, parentIdx: null, iconId: 2 })),
        };
      }
      if (cmd === 'load_surface_overlay') {
        if (args.path === '/d/lh.sulc.shape.gii') return { handle: 'ov1' };
        throw new Error('Overlay file not found');
      }
      if (cmd === 'get_surface_overlay_data') return Array.from({ length: n }, (_, i) => i % 7);
      if (cmd === 'unload_surface_overlay') return { success: true };
      throw new Error(`not found: ${cmd}`);
    });
    const service = new SurfaceCurvatureService();
    const lh = surface('s1', 'inflated', '/d/lh.inflated.gii', mesh);
    const found = await service.readSidecar(lh, n);
    expect(found?.path).toBe('/d/lh.sulc.shape.gii');
    expect(found?.values.length).toBe(n);
    expect(invoke).toHaveBeenCalledWith('unload_surface_overlay', { handle: 'ov1' });
    // Files the folder does not hold are never probed.
    const probed = invoke.mock.calls.filter(([cmd]) => cmd === 'load_surface_overlay').map(([, a]) => a.path);
    expect(probed).toEqual(['/d/lh.sulc.shape.gii']);
  });

  it('else sulcal depth from the matching folded mesh (an inflated mesh alone gets none)', async () => {
    invoke.mockRejectedValue(new Error('not found'));
    const folded = foldedMesh();
    const inflated = { vertices: folded.vertices.map((v) => v * 1.4), faces: folded.faces };
    const service = new SurfaceCurvatureService();
    useSurfaceStore.setState({
      surfaces: new Map([['infl', surface('infl', 'inflated', '/d/lh.inflated.gii', inflated)]]),
    });
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(useSurfaceStore.getState().surfaces.get('infl')?.curvature ?? null).toBeNull();

    // The folded (white) mesh of the same topology arrives: depth is computed.
    useSurfaceStore.setState((state) => {
      const surfaces = new Map(state.surfaces);
      surfaces.set('white', surface('white', 'white', '/d/lh.white.gii', folded));
      return { surfaces };
    });
    await vi.waitFor(() => expect(useSurfaceStore.getState().surfaces.get('infl')?.curvature).toBeTruthy(), { timeout: 5000 });
    const infl = useSurfaceStore.getState().surfaces.get('infl')!;
    expect(infl.curvature!.length).toBe(folded.vertices.length / 3);
    expect(infl.curvatureSource).toEqual({ kind: 'computed', from: 'folded mesh' });
    // Depth varies over the ripple (not a constant).
    const values = Array.from(infl.curvature!);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.1);
    service.stop();
  });
});
