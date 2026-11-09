import { describe, expect, it } from 'vitest';
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';
import {
  alignMedialEdge,
  anatomicalStandIn,
  buildSurfaceDisplays,
  familyGeometries,
  geometryChoices,
  familyOverlays,
  surfaceFamily,
} from '../surfaceFamilies';
import { collectRenderSurfaces } from '../surfaceRenderSurfaces';

const FACES = new Uint32Array([0, 1, 2]);

function mesh(
  handle: string,
  path: string,
  hemisphere: 'left' | 'right',
  type: 'pial' | 'white' | 'inflated' | 'sphere',
  xs: [number, number, number],
  faces: Uint32Array = new Uint32Array(FACES),
): LoadedSurface {
  return {
    handle,
    name: path.split('/').pop()!,
    visible: true,
    geometry: {
      vertices: new Float32Array([xs[0], 0, 0, xs[1], 1, 0, xs[2], 0, 1]),
      faces,
      hemisphere,
      surfaceType: type,
    },
    layers: new Map(),
    metadata: { vertexCount: 3, faceCount: 1, hemisphere, surfaceType: type, path },
  };
}

function layer(id: string): SurfaceDataLayer {
  return {
    id,
    name: id,
    values: new Float32Array([1, 2, 3]),
    colormap: 'hot',
    range: [0, 3],
    dataRange: [0, 3],
    opacity: 1,
    visible: true,
  };
}

function subject(): Map<string, LoadedSurface> {
  const lhPial = mesh('lh-pial', '/s/surf/lh.pial.gii', 'left', 'pial', [-40, -20, -5]);
  const lhWhite = mesh('lh-white', '/s/surf/lh.white.gii', 'left', 'white', [-38, -22, -6]);
  const lhInfl = mesh('lh-infl', '/s/surf/lh.inflated.gii', 'left', 'inflated', [-30, 0, 30]);
  const rhPial = mesh('rh-pial', '/s/surf/rh.pial.gii', 'right', 'pial', [5, 20, 40]);
  const rhInfl = mesh('rh-infl', '/s/surf/rh.inflated.gii', 'right', 'inflated', [-30, 0, 30]);
  return new Map([lhPial, lhWhite, lhInfl, rhPial, rhInfl].map((s) => [s.handle, s]));
}

describe('surfaceFamily', () => {
  it('collects the geometries of one hemisphere of one subject, in load order', () => {
    const all = subject();
    const family = surfaceFamily(all.get('lh-infl')!, all.values());
    expect(family.map((s) => s.handle)).toEqual(['lh-pial', 'lh-white', 'lh-infl']);
    expect(familyGeometries(family)).toEqual(['pial', 'white', 'inflated']);
  });

  it('leaves out meshes of another topology, subject or hemisphere', () => {
    const all = subject();
    all.set(
      'lh-other',
      mesh('lh-other', '/s/surf/lh.sphere.gii', 'left', 'sphere', [0, 1, 2], new Uint32Array([0, 2, 1])),
    );
    all.set('lh-s2', mesh('lh-s2', '/s2/surf/lh.white.gii', 'left', 'white', [0, 1, 2]));
    const family = surfaceFamily(all.get('lh-pial')!, all.values());
    expect(family.map((s) => s.handle)).toEqual(['lh-pial', 'lh-white', 'lh-infl']);
  });

  it('is the surface alone without a recognisable name', () => {
    const lone = mesh('x', '/s/brain.gii', 'left', 'pial', [0, 1, 2]);
    expect(surfaceFamily(lone, [lone])).toEqual([lone]);
  });
});

describe('buildSurfaceDisplays', () => {
  it('draws the chosen geometry under the family handle with every embedding', () => {
    const all = subject();
    const [display] = buildSurfaceDisplays([all.get('lh-white')!], all);
    expect(display.handle).toBe('lh-pial');
    expect(display.shownHandle).toBe('lh-white');
    expect(display.variant).toBe('white');
    expect(Object.keys(display.variants!)).toEqual(['pial', 'white', 'inflated']);
    expect(display.geometry.vertices).toBe(all.get('lh-white')!.geometry.vertices);
    // One face array for the family, so a switch morphs instead of rebuilding.
    expect(display.geometry.faces).toBe(all.get('lh-pial')!.geometry.faces);
    expect(display.memberHandles).toEqual(['lh-pial', 'lh-white', 'lh-infl']);
  });

  it("switches geometry by the view's choice, keeping the handle and faces", () => {
    const all = subject();
    const [pial] = buildSurfaceDisplays([all.get('lh-pial')!], all);
    const [inflated] = buildSurfaceDisplays([all.get('lh-pial')!], all, 'inflated');
    expect(inflated.handle).toBe(pial.handle);
    expect(inflated.geometry.faces).toBe(pial.geometry.faces);
    expect(inflated.variant).toBe('inflated');
    expect(inflated.geometry.vertices).toBe(inflated.variants!.inflated);
    // A geometry the family lacks falls back to the chosen mesh.
    const [sphere] = buildSurfaceDisplays([all.get('lh-pial')!], all, 'sphere');
    expect(sphere.variant).toBe('pial');
  });

  it('draws the overlays of every geometry on the one shown', () => {
    const all = subject();
    all.get('lh-pial')!.layers.set('zstat', layer('zstat'));
    all.get('lh-infl')!.layers.set('thickness', layer('thickness'));
    const [display] = buildSurfaceDisplays([all.get('lh-white')!], all, 'inflated');
    expect([...display.layers.keys()]).toEqual(['zstat', 'thickness']);
    expect([...familyOverlays(all.get('lh-white')!, all.values()).keys()]).toEqual([
      'zstat',
      'thickness',
    ]);
  });

  it('aligns an inflated hemisphere’s medial edge with its folded mesh', () => {
    const all = subject();
    const [left] = buildSurfaceDisplays([all.get('lh-pial')!], all, 'inflated');
    const xs = [0, 3, 6].map((i) => left.geometry.vertices[i]);
    // The white mesh's medial (largest x) edge is -6.
    expect(Math.max(...xs)).toBeCloseTo(-6);
    // Anatomical embeddings are never moved.
    expect(left.variants!.pial).toBe(all.get('lh-pial')!.geometry.vertices);
    // Same input, same array (the viewer compares by reference).
    const [again] = buildSurfaceDisplays([all.get('lh-pial')!], all, 'inflated');
    expect(again.variants!.inflated).toBe(left.variants!.inflated);
  });

  it('parts two unfolded hemispheres with no folded reference at the midline', () => {
    const lh = mesh('lh', '/t/lh.inflated.gii', 'left', 'inflated', [-30, 0, 30]);
    const rh = mesh('rh', '/t/rh.inflated.gii', 'right', 'inflated', [-30, 0, 30]);
    const all = new Map([lh, rh].map((s) => [s.handle, s]));
    const [left, right] = buildSurfaceDisplays([lh, rh], all);
    const lx = [0, 3, 6].map((i) => left.geometry.vertices[i]);
    const rx = [0, 3, 6].map((i) => right.geometry.vertices[i]);
    expect(Math.max(...lx)).toBeLessThan(Math.min(...rx));
    // A single hemisphere is drawn where it is.
    const [alone] = buildSurfaceDisplays([lh], new Map([[lh.handle, lh]]));
    expect(alone).toBe(lh);
  });

  it('pairs each hemisphere’s family in a scene tab', () => {
    const all = subject();
    const chosen = collectRenderSurfaces(all, 'lh-pial', '/s/surf/hemi-pair.{geometry}.gii');
    const displays = buildSurfaceDisplays(chosen, all, 'inflated');
    expect(displays.map((d) => [d.handle, d.variant])).toEqual([
      ['lh-pial', 'inflated'],
      ['rh-pial', 'inflated'],
    ]);
  });
});

describe('alignMedialEdge', () => {
  it('moves the right hemisphere’s smallest x to the given edge', () => {
    const vertices = new Float32Array([10, 0, 0, 20, 0, 0, 30, 0, 0]);
    const out = alignMedialEdge(vertices, 'right', 2);
    expect([out[0], out[3], out[6]]).toEqual([2, 12, 22]);
    expect(vertices[0]).toBe(10);
  });
});

describe('geometryChoices', () => {
  it('lists drawn geometries, then those the set offers for the drawn hemispheres', () => {
    const all = subject();
    all.delete('lh-infl');
    const displays = buildSurfaceDisplays([all.get('lh-pial')!], all);
    const set = [
      { path: '/s/surf/lh.pial.gii', geometry: 'pial', hemisphere: 'left' as const },
      { path: '/s/surf/lh.inflated.gii', geometry: 'inflated', hemisphere: 'left' as const },
      { path: '/s/surf/lh.sphere.gii', geometry: 'sphere', hemisphere: 'left' as const },
      { path: '/s/surf/rh.white.gii', geometry: 'white', hemisphere: 'right' as const },
    ];
    const loaded = new Set([...all.values()].map((s) => s.metadata.path));
    const choices = geometryChoices(displays, set, loaded);
    expect(choices.map((c) => [c.geometry, c.toLoad.map((m) => m.path)])).toEqual([
      ['pial', []],
      ['white', []],
      ['inflated', ['/s/surf/lh.inflated.gii']],
      ['sphere', ['/s/surf/lh.sphere.gii']],
    ]);
  });
});

describe('overlays on unfolded geometries', () => {
  it('samples a volume through the folded mesh standing in for an inflated one', () => {
    const all = subject();
    expect(anatomicalStandIn(all.get('lh-infl')!, all.values())?.handle).toBe('lh-white');
    expect(anatomicalStandIn(all.get('lh-pial')!, all.values())?.handle).toBe('lh-pial');
    // rh has pial and inflated only.
    expect(anatomicalStandIn(all.get('rh-infl')!, all.values())?.handle).toBe('rh-pial');
    const lone = mesh('x', '/t/lh.inflated.gii', 'left', 'inflated', [0, 1, 2]);
    expect(anatomicalStandIn(lone, [lone])).toBeNull();
  });

  it('draws a GPU volume layer on inflated as values sampled at the folded vertices', () => {
    const all = subject();
    // x-ramp volume: value = voxel x; identity affine shifted so world x = -40 is voxel 0.
    const nx = 64;
    const volume = new Float32Array(nx * 2 * 2);
    for (let i = 0; i < volume.length; i++) volume[i] = i % nx;
    const affine = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -40, 0, 0, 1]);
    all.get('lh-pial')!.layers.set('gpu', {
      ...layer('gpu'),
      values: new Float32Array(0),
      volumeData: volume.buffer,
      volumeDims: [nx, 2, 2],
      affineMatrix: affine,
    });
    const [onPial] = buildSurfaceDisplays([all.get('lh-pial')!], all);
    expect(onPial.layers.get('gpu')!.volumeData).toBeDefined(); // folded: the shader samples
    const [onInflated] = buildSurfaceDisplays([all.get('lh-pial')!], all, 'inflated');
    const sampled = onInflated.layers.get('gpu')!;
    expect(sampled.volumeData).toBeUndefined();
    // White vertices x = -38, -22, -6  ->  voxel x 2, 18, 34.
    expect(Array.from(sampled.values)).toEqual([2, 18, 34]);
  });
});
