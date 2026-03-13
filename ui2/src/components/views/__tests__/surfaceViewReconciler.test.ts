import { describe, expect, it } from 'vitest';
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';
import {
  buildRenderableLayerSpecs,
  planSurfaceReconciliation,
} from '../surfaceViewReconciler';

function makeLayer(
  id: string,
  overrides: Partial<SurfaceDataLayer> = {}
): SurfaceDataLayer {
  return {
    id,
    name: id,
    values: new Float32Array([0.1, 0.2, 0.3]),
    indices: new Uint32Array([0, 1, 2]),
    visible: true,
    colormap: 'viridis',
    range: [0, 1],
    dataRange: [0, 1],
    threshold: [0, 0],
    opacity: 1,
    ...overrides,
  };
}

function makeSurface(
  handle: string,
  layers: SurfaceDataLayer[],
  overrides: Partial<LoadedSurface> = {}
): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(layers.map((layer) => [layer.id, layer])),
    metadata: {
      vertexCount: 3,
      faceCount: 1,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `/tmp/${handle}.gii`,
    },
    ...overrides,
  };
}

function cloneSurface(
  surface: LoadedSurface,
  overrides: Partial<LoadedSurface> = {}
): LoadedSurface {
  return {
    ...surface,
    ...overrides,
    geometry: overrides.geometry ?? surface.geometry,
    layers: overrides.layers ?? surface.layers,
    metadata: overrides.metadata ?? surface.metadata,
  };
}

describe('surfaceViewReconciler', () => {
  it('plans an in-place layer update for non-structural property changes', () => {
    const previous = makeSurface('lh', [makeLayer('overlay')]);
    const next = cloneSurface(previous, {
      layers: new Map([['overlay', makeLayer('overlay', { opacity: 0.4 })]]),
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: false,
    });

    expect(plan.requiresRebuild).toBe(false);
    expect(plan.removeLayerIds).toEqual([]);
    expect(plan.addLayers).toEqual([]);
    expect(plan.updateLayers.map((layer) => layer.id)).toEqual(['overlay']);
  });

  it('treats replaced geometry arrays as a rebuild even when lengths match', () => {
    const previous = makeSurface('lh', [makeLayer('overlay')]);
    const next = makeSurface('lh', [makeLayer('overlay')], {
      geometry: {
        vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
        faces: new Uint32Array([0, 1, 2]),
        hemisphere: 'left',
        surfaceType: 'pial',
      },
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: false,
    });

    expect(plan.requiresRebuild).toBe(true);
  });

  it('removes hidden layers from the render plan', () => {
    const previous = makeSurface('lh', [makeLayer('overlay')]);
    const next = cloneSurface(previous, {
      layers: new Map([['overlay', makeLayer('overlay', { visible: false })]]),
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: false,
    });

    expect(plan.removeLayerIds).toEqual(['overlay']);
    expect(plan.addLayers).toEqual([]);
    expect(plan.updateLayers).toEqual([]);
  });

  it('tracks layer order changes without forcing a rebuild', () => {
    const previous = makeSurface('lh', [makeLayer('a'), makeLayer('b')]);
    const next = cloneSurface(previous, {
      layers: new Map([
        ['b', makeLayer('b')],
        ['a', makeLayer('a')],
      ]),
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: false,
    });

    expect(plan.requiresRebuild).toBe(false);
    expect(plan.orderChanged).toBe(true);
    expect(plan.orderedLayerIds).toEqual(['b', 'a']);
  });

  it('switches volume-capable overlays between CPU and GPU layer kinds incrementally', () => {
    const volumeData = new Float32Array([0, 1, 2, 3]).buffer;
    const previous = makeSurface('lh', [
      makeLayer('projection', {
        volumeData,
        volumeDims: [2, 2, 1],
      }),
    ]);
    const next = cloneSurface(previous);

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: true,
    });

    expect(plan.requiresRebuild).toBe(false);
    expect(plan.compositingModeChanged).toBe(true);
    expect(plan.removeLayerIds).toEqual(['projection']);
    expect(plan.addLayers.map((layer) => layer.kind)).toEqual(['volume']);
  });

  it('filters invisible layers when building render specs', () => {
    const surface = makeSurface('lh', [
      makeLayer('visible'),
      makeLayer('hidden', { visible: false }),
    ]);

    const specs = buildRenderableLayerSpecs(surface, false);

    expect(specs.map((spec) => spec.id)).toEqual(['visible']);
  });
});
