import { describe, expect, it } from 'vitest';
import type { SurfaceRenderable, SurfaceRenderableLayer } from '../types';
import {
  buildRenderableLayerSpecs,
  planSurfaceReconciliation,
} from '../surfaceReconciler';

function makeLayer(
  id: string,
  overrides: Partial<SurfaceRenderableLayer> = {}
): SurfaceRenderableLayer {
  return {
    id,
    values: new Float32Array([0.1, 0.2, 0.3]),
    indices: new Uint32Array([0, 1, 2]),
    visible: true,
    colormap: 'viridis',
    range: [0, 1],
    threshold: [0, 0],
    opacity: 1,
    ...overrides,
  };
}

function makeSurface(
  handle: string,
  layers: SurfaceRenderableLayer[],
  overrides: Partial<SurfaceRenderable> = {}
): SurfaceRenderable {
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
    layers,
    ...overrides,
  };
}

function cloneSurface(
  surface: SurfaceRenderable,
  overrides: Partial<SurfaceRenderable> = {}
): SurfaceRenderable {
  return {
    ...surface,
    ...overrides,
    geometry: overrides.geometry ?? surface.geometry,
    layers: overrides.layers ?? surface.layers,
  };
}

describe('surfaceViewer surfaceReconciler', () => {
  it('plans add/remove/order operations for generic array-backed layer lists', () => {
    const layerB = makeLayer('b');
    const previous = makeSurface('lh', [makeLayer('a'), layerB]);
    const next = cloneSurface(previous, {
      layers: [layerB, makeLayer('c')],
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: false,
      nextUseGPUProjection: false,
    });

    expect(plan.requiresRebuild).toBe(false);
    expect(plan.removeLayerIds).toEqual(['a']);
    expect(plan.addLayers.map((layer) => layer.id)).toEqual(['c']);
    expect(plan.updateLayers).toEqual([]);
    expect(plan.orderChanged).toBe(true);
    expect(plan.orderedLayerIds).toEqual(['b', 'c']);
  });

  it('retains GPU projection metadata in volume render specs', () => {
    const volumeData = new Float32Array([0, 1, 2, 3]).buffer;
    const affineMatrix = new Float32Array(16).fill(1);
    const surface = makeSurface('lh', [
      makeLayer('projection', {
        volumeData,
        volumeDims: [2, 2, 1],
        affineMatrix,
        range: [0, 3],
        threshold: [1, 2],
        opacity: 0.5,
      }),
    ]);

    const specs = buildRenderableLayerSpecs(surface, true);

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: 'projection',
      kind: 'volume',
      volumeData,
      volumeDims: [2, 2, 1],
      affineMatrix,
      range: [0, 3],
      threshold: [1, 2],
      opacity: 0.5,
    });
  });

  it('updates a GPU projection layer when affine metadata changes without rebuilding geometry', () => {
    const volumeData = new Float32Array([0, 1, 2, 3]).buffer;
    const previous = makeSurface('lh', [
      makeLayer('projection', {
        volumeData,
        volumeDims: [2, 2, 1],
        affineMatrix: new Float32Array(16).fill(1),
      }),
    ]);
    const next = cloneSurface(previous, {
      layers: [
        makeLayer('projection', {
          volumeData,
          volumeDims: [2, 2, 1],
          affineMatrix: new Float32Array(16).fill(2),
        }),
      ],
    });

    const plan = planSurfaceReconciliation(previous, next, {
      previousUseGPUProjection: true,
      nextUseGPUProjection: true,
    });

    expect(plan.requiresRebuild).toBe(false);
    expect(plan.removeLayerIds).toEqual([]);
    expect(plan.addLayers).toEqual([]);
    expect(plan.updateLayers.map((layer) => layer.id)).toEqual(['projection']);
  });
});
