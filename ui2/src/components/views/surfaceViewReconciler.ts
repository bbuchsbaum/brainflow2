import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';

export type RenderableLayerKind = 'data' | 'rgba' | 'volume';

export interface RenderableLayerSpec {
  id: string;
  kind: RenderableLayerKind;
  colormap?: string;
  range?: [number, number];
  threshold?: [number, number];
  opacity: number;
  values?: Float32Array;
  indices?: Uint32Array | null;
  rgba?: Float32Array;
  volumeData?: ArrayBuffer;
  volumeDims?: [number, number, number];
  affineMatrix?: Float32Array;
}

export interface SurfaceReconciliationPlan {
  requiresRebuild: boolean;
  compositingModeChanged: boolean;
  removeLayerIds: string[];
  addLayers: RenderableLayerSpec[];
  updateLayers: RenderableLayerSpec[];
  orderedLayerIds: string[];
  orderChanged: boolean;
}

interface PlanSurfaceReconciliationOptions {
  previousUseGPUProjection: boolean;
  nextUseGPUProjection: boolean;
}

function rangesEqual(
  left?: [number, number],
  right?: [number, number]
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left[0] === right[0] && left[1] === right[1];
}

function dimsEqual(
  left?: [number, number, number],
  right?: [number, number, number]
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function float32ArrayValuesEqual(
  left?: Float32Array,
  right?: Float32Array
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function shouldUseVolumeProjection(
  layer: SurfaceDataLayer,
  useGPUProjection: boolean
): boolean {
  return Boolean(
    useGPUProjection &&
      layer.volumeData &&
      layer.volumeDims &&
      layer.volumeDims.length === 3
  );
}

export function isSurfaceGeometryChanged(
  previousSurface: LoadedSurface,
  nextSurface: LoadedSurface
): boolean {
  return (
    previousSurface.geometry.vertices !== nextSurface.geometry.vertices ||
    previousSurface.geometry.faces !== nextSurface.geometry.faces ||
    previousSurface.geometry.vertices.length !== nextSurface.geometry.vertices.length ||
    previousSurface.geometry.faces.length !== nextSurface.geometry.faces.length ||
    previousSurface.geometry.hemisphere !== nextSurface.geometry.hemisphere ||
    previousSurface.geometry.surfaceType !== nextSurface.geometry.surfaceType
  );
}

export function buildRenderableLayerSpec(
  layer: SurfaceDataLayer,
  useGPUProjection: boolean
): RenderableLayerSpec {
  if (layer.rgba) {
    return {
      id: layer.id,
      kind: 'rgba',
      rgba: layer.rgba,
      opacity: layer.opacity ?? 1,
    };
  }

  if (shouldUseVolumeProjection(layer, useGPUProjection)) {
    return {
      id: layer.id,
      kind: 'volume',
      volumeData: layer.volumeData,
      volumeDims: layer.volumeDims,
      affineMatrix: layer.affineMatrix,
      colormap: layer.colormap || 'viridis',
      range: layer.range,
      threshold: layer.threshold,
      opacity: layer.opacity ?? 1,
    };
  }

  return {
    id: layer.id,
    kind: 'data',
    values: layer.values,
    indices: layer.indices ?? null,
    colormap: layer.colormap || 'viridis',
    range: layer.range,
    threshold: layer.threshold,
    opacity: layer.opacity ?? 1,
  };
}

export function buildRenderableLayerSpecs(
  surface: LoadedSurface,
  useGPUProjection: boolean
): RenderableLayerSpec[] {
  return Array.from(surface.layers.values())
    .filter((layer) => layer.visible !== false)
    .map((layer) => buildRenderableLayerSpec(layer, useGPUProjection));
}

export function areRenderableLayerSpecsEqual(
  previousSpec: RenderableLayerSpec,
  nextSpec: RenderableLayerSpec
): boolean {
  if (previousSpec.kind !== nextSpec.kind) return false;
  if (previousSpec.colormap !== nextSpec.colormap) return false;
  if (previousSpec.opacity !== nextSpec.opacity) return false;
  if (!rangesEqual(previousSpec.range, nextSpec.range)) return false;
  if (!rangesEqual(previousSpec.threshold, nextSpec.threshold)) return false;

  switch (previousSpec.kind) {
    case 'rgba':
      return previousSpec.rgba === nextSpec.rgba;
    case 'data':
      return (
        previousSpec.values === nextSpec.values &&
        previousSpec.indices === nextSpec.indices
      );
    case 'volume':
      return (
        previousSpec.volumeData === nextSpec.volumeData &&
        dimsEqual(previousSpec.volumeDims, nextSpec.volumeDims) &&
        float32ArrayValuesEqual(previousSpec.affineMatrix, nextSpec.affineMatrix)
      );
    default:
      return false;
  }
}

export function planSurfaceReconciliation(
  previousSurface: LoadedSurface,
  nextSurface: LoadedSurface,
  options: PlanSurfaceReconciliationOptions
): SurfaceReconciliationPlan {
  if (isSurfaceGeometryChanged(previousSurface, nextSurface)) {
    return {
      requiresRebuild: true,
      compositingModeChanged:
        options.previousUseGPUProjection !== options.nextUseGPUProjection,
      removeLayerIds: [],
      addLayers: [],
      updateLayers: [],
      orderedLayerIds: [],
      orderChanged: false,
    };
  }

  const previousSpecs = buildRenderableLayerSpecs(
    previousSurface,
    options.previousUseGPUProjection
  );
  const nextSpecs = buildRenderableLayerSpecs(
    nextSurface,
    options.nextUseGPUProjection
  );

  const previousSpecsById = new Map(
    previousSpecs.map((spec) => [spec.id, spec] as const)
  );
  const nextSpecsById = new Map(nextSpecs.map((spec) => [spec.id, spec] as const));

  const removeLayerIds: string[] = [];
  const addLayers: RenderableLayerSpec[] = [];
  const updateLayers: RenderableLayerSpec[] = [];

  for (const [layerId, previousSpec] of previousSpecsById.entries()) {
    const nextSpec = nextSpecsById.get(layerId);
    if (!nextSpec || nextSpec.kind !== previousSpec.kind) {
      removeLayerIds.push(layerId);
    }
  }

  for (const nextSpec of nextSpecs) {
    const previousSpec = previousSpecsById.get(nextSpec.id);
    if (!previousSpec || previousSpec.kind !== nextSpec.kind) {
      addLayers.push(nextSpec);
      continue;
    }

    if (
      previousSpec.kind === 'volume' &&
      nextSpec.kind === 'volume' &&
      !dimsEqual(previousSpec.volumeDims, nextSpec.volumeDims)
    ) {
      removeLayerIds.push(nextSpec.id);
      addLayers.push(nextSpec);
      continue;
    }

    if (!areRenderableLayerSpecsEqual(previousSpec, nextSpec)) {
      updateLayers.push(nextSpec);
    }
  }

  const previousOrder = previousSpecs.map((spec) => spec.id);
  const nextOrder = nextSpecs.map((spec) => spec.id);
  const orderChanged =
    previousOrder.length !== nextOrder.length ||
    previousOrder.some((layerId, index) => layerId !== nextOrder[index]);

  return {
    requiresRebuild: false,
    compositingModeChanged:
      options.previousUseGPUProjection !== options.nextUseGPUProjection,
    removeLayerIds,
    addLayers,
    updateLayers,
    orderedLayerIds: nextOrder,
    orderChanged,
  };
}
