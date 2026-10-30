/**
 * Voxel-exact navigation (UI redesign phase 3, item 2).
 *
 * The crosshair snaps to the centre of the nearest voxel of a single
 * *reference grid*: the bottom-most volume layer with a usable affine (the
 * first `layerStore.layers` entry that has a volume and `voxelToWorld` /
 * `worldToVoxel`), whatever its visibility. That is the base/anatomical image
 * in practice, it does not change when the user selects an overlay, and it
 * is the same reference the Go-to dialog uses for voxel mode, so world ->
 * voxel -> world round trips there land exactly where snapping puts them.
 *
 * Rounding is `floor(v + 0.5)` per axis, identical to the backend's
 * `volume_queries::nearest_voxel` (which `sample_nearest` and
 * `sample_layer_value_at_world` use), so the snapped crosshair, the ijk
 * readout and the sampled value always refer to the same voxel. Snapping is
 * applied to the lattice, not clamped to the volume: a point outside the grid
 * stays outside (and samples as "—").
 */
import type { LayerInfo, VolumeMetadata } from '@/stores/layerStore';
import {
  isAffine4x4,
  transformVoxelToWorldColumnMajor,
  transformWorldToVoxelColumnMajor,
  type WorldCoord3,
} from './voxelTransform';

export interface VoxelGridReference {
  layerId: string;
  name: string;
  /** Column-major flattened 4x4 (backend GPU-info layout). */
  voxelToWorld: number[];
  /** Column-major flattened 4x4 inverse. */
  worldToVoxel: number[];
  dims: [number, number, number] | null;
}

/** Nearest voxel index along each axis: `floor(v + 0.5)` (backend `nearest_voxel`). */
export function nearestVoxelIndex(voxel: WorldCoord3): WorldCoord3 {
  return [Math.floor(voxel[0] + 0.5), Math.floor(voxel[1] + 0.5), Math.floor(voxel[2] + 0.5)];
}

/** Nearest voxel index of a world position on the reference grid. */
export function worldToVoxelIndex(
  world: WorldCoord3,
  reference: Pick<VoxelGridReference, 'worldToVoxel'>,
): WorldCoord3 {
  return nearestVoxelIndex(transformWorldToVoxelColumnMajor(reference.worldToVoxel, world));
}

/**
 * "69, 36, 34" for a voxel index: the one ijk format (status bar, Inspector
 * caption, cluster table). Displays prefix it with "ijk" and name the grid
 * (`formatIjkReadout`), so it is never read as mm. Integers when snapped;
 * otherwise one decimal ("47.5"). U+2212 minus.
 */
export function formatVoxelIndex(index: readonly number[], decimals = 0): string {
  return index
    .map((v) => {
      const text = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
      return (Number(text) === 0 ? text.replace('-', '') : text).replace('-', '\u2212');
    })
    .join(', ');
}

/**
 * "ijk 23, 41, 30 (zstat1)": a voxel index always names its grid (QA design
 * decisions 2026-10-30, section 3). `index` null (outside the grid) reads
 * "ijk — (zstat1)", so the grid stays named.
 */
export function formatIjkReadout(index: string | null, gridName: string): string {
  return `ijk ${index ?? '\u2014'} (${gridName})`;
}

/** True when an integer voxel index lies inside `dims`. */
export function voxelIndexInBounds(
  index: WorldCoord3,
  dims: [number, number, number] | null | undefined,
): boolean {
  if (!dims) return true;
  return index.every((v, axis) => v >= 0 && v < dims[axis]);
}

/**
 * World position of the centre of the voxel nearest `world` on the
 * reference grid. Non-finite input or output returns the input unchanged.
 */
export function snapWorldToVoxelCentre(
  world: WorldCoord3,
  reference: Pick<VoxelGridReference, 'worldToVoxel' | 'voxelToWorld'>,
): WorldCoord3 {
  if (!world.every(Number.isFinite)) return world;
  const index = worldToVoxelIndex(world, reference);
  const snapped = transformVoxelToWorldColumnMajor(reference.voxelToWorld, index);
  if (!snapped.every(Number.isFinite)) return world;
  // Strip float noise from the f32 affine (e.g. 50.49999 -> 50.5) without
  // moving a genuine centre: the result stays within 1e-6 mm.
  return snapped.map((v) => Math.round(v * 1e6) / 1e6) as WorldCoord3;
}

/** The voxel-grid reference layer (see module comment), or null. */
export function resolveVoxelGridReference(
  layers: ReadonlyArray<Pick<LayerInfo, 'id' | 'name' | 'volumeId'>>,
  layerMetadata: ReadonlyMap<string, VolumeMetadata> | undefined,
): VoxelGridReference | null {
  if (!layerMetadata) return null;
  for (const layer of layers) {
    if (!layer.volumeId) continue;
    const meta = layerMetadata.get(layer.id);
    if (!isAffine4x4(meta?.voxelToWorld) || !isAffine4x4(meta?.worldToVoxel)) continue;
    return {
      layerId: layer.id,
      name: layer.name,
      voxelToWorld: meta!.voxelToWorld!,
      worldToVoxel: meta!.worldToVoxel!,
      dims: meta?.dimensions ?? null,
    };
  }
  return null;
}

/** A layer's own voxel grid, or null when it has no usable affine. */
export function resolveLayerVoxelGrid(
  layerId: string | null | undefined,
  layers: ReadonlyArray<Pick<LayerInfo, 'id' | 'name' | 'volumeId'>>,
  layerMetadata: ReadonlyMap<string, VolumeMetadata> | undefined,
): VoxelGridReference | null {
  if (!layerId || !layerMetadata) return null;
  const layer = layers.find((l) => l.id === layerId);
  const meta = layerMetadata.get(layerId);
  if (!layer?.volumeId || !isAffine4x4(meta?.voxelToWorld) || !isAffine4x4(meta?.worldToVoxel)) return null;
  return {
    layerId,
    name: layer.name,
    voxelToWorld: meta!.voxelToWorld!,
    worldToVoxel: meta!.worldToVoxel!,
    dims: meta?.dimensions ?? null,
  };
}

/** The grid a readout's ijk is on, and whether it is the snapping reference. */
export interface ReadoutGrid extends VoxelGridReference {
  isReference: boolean;
}

/**
 * The grid every ijk readout uses: the given (selected / reported) layer's
 * own grid, so the status bar, the Inspector caption and the cluster table
 * (whose peaks are on the map's grid) agree for the same layer. Falls back to
 * the reference grid when that layer has no affine (none selected, a
 * surface).
 */
export function resolveReadoutGrid(
  layerId: string | null | undefined,
  layers: ReadonlyArray<Pick<LayerInfo, 'id' | 'name' | 'volumeId'>>,
  layerMetadata: ReadonlyMap<string, VolumeMetadata> | undefined,
): ReadoutGrid | null {
  const reference = resolveVoxelGridReference(layers, layerMetadata);
  const own = resolveLayerVoxelGrid(layerId, layers, layerMetadata);
  const grid = own ?? reference;
  if (!grid) return null;
  return { ...grid, isReference: !!reference && reference.layerId === grid.layerId };
}

/**
 * True when two world points fall in the same voxel of a grid (or are equal,
 * without one): a reading taken at `a` is still current at `b`.
 */
export function sameVoxel(
  a: readonly number[],
  b: readonly number[],
  grid: Pick<VoxelGridReference, 'worldToVoxel'> | null | undefined,
): boolean {
  if (!grid) return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const ia = worldToVoxelIndex([a[0], a[1], a[2]], grid);
  const ib = worldToVoxelIndex([b[0], b[1], b[2]], grid);
  return ia.every((v, i) => v === ib[i]);
}

/**
 * Where the current reference comes from. The layer store registers itself
 * (stores/layerStore.ts) so the view-state store can snap without importing
 * it: layerStore subscribes to the event bus at module load, which a static
 * import from viewStateStore would drag into every consumer.
 */
let referenceProvider: (() => VoxelGridReference | null) | null = null;

export function setVoxelGridReferenceProvider(provider: (() => VoxelGridReference | null) | null): void {
  referenceProvider = provider;
}

/** The current voxel-grid reference, or null when no layer store / volume. */
export function currentVoxelGridReference(): VoxelGridReference | null {
  return referenceProvider ? referenceProvider() : null;
}
