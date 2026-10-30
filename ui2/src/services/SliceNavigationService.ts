/** World-space slice navigation, using the reference volume's sampling grid. */
import type { ViewType } from '@/types/coordinates';
import { useLayerStore, type VolumeMetadata } from '@/stores/layerStore';
import { snapCrosshairToVoxelGrid, useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { currentVoxelGridReference } from '@/utils/voxelSnap';

export interface SliceRange { min: number; max: number; step: number; current: number; }

const AXIS: Record<ViewType, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 };

/**
 * The grid slices step on. With snapping on it is the SNAPPING reference
 * (utils/voxelSnap: the bottom volume layer), so every step lands on the
 * next reference voxel: stepping on a finer layer's grid (a 1 mm T1 over a
 * 2 mm reference) asked for half a voxel, which the snap rounded back, and
 * the slice never moved (review D1). Otherwise `fallback` (the view's own
 * layer), as before.
 */
export function navigationMetadata(fallback?: VolumeMetadata): VolumeMetadata | undefined {
  if (useCrosshairSettingsStore.getState().settings.snapToVoxel) {
    const reference = currentVoxelGridReference();
    const metadata = reference ? useLayerStore.getState().getLayerMetadata(reference.layerId) : undefined;
    if (metadata?.worldBounds) return metadata;
  }
  return fallback;
}

/** Slice range along `axis` on the navigation grid (see navigationMetadata). */
export function navigationSliceRange(
  axis: 0 | 1 | 2,
  current: number,
  fallback?: VolumeMetadata,
): SliceRange {
  return sliceRangeForMetadata(navigationMetadata(fallback), axis, current);
}

/**
 * Position `steps` slices from `current` along `axis` (wheel, PageUp/Down,
 * the Compare rail), clamped to the range. With snapping on, a step that
 * the snap would round back to the current slice (an oblique or offset
 * grid) is extended until the snapped slice moves, so a step always moves.
 */
export function steppedSlicePosition(
  range: SliceRange,
  crosshair: readonly [number, number, number],
  axis: 0 | 1 | 2,
  steps: number,
): number {
  const current = crosshair[axis];
  const clamp = (v: number) => Math.max(range.min, Math.min(range.max, v));
  if (steps === 0) return current;
  const snapped = (v: number) => {
    const p: [number, number, number] = [crosshair[0], crosshair[1], crosshair[2]];
    p[axis] = v;
    return snapCrosshairToVoxelGrid(p)[axis];
  };
  const here = snapped(current);
  for (let k = Math.abs(steps); k <= Math.abs(steps) + 4; k += 1) {
    const candidate = clamp(current + Math.sign(steps) * k * range.step);
    const landed = snapped(candidate);
    if (Math.sign(landed - here) === Math.sign(steps)) return landed;
    if (candidate === range.min || candidate === range.max) return current;
  }
  return current;
}

export class SliceNavigationService {
  getSliceRange(viewType: ViewType): SliceRange {
    const axis = AXIS[viewType];
    const layers = useLayerStore.getState();
    const visible = layers.layers.find(layer => layer.visible);
    const fallback = visible ? layers.getLayerMetadata(visible.id) : undefined;
    const current = useViewStateStore.getState().viewState.crosshair.world_mm[axis];
    return navigationSliceRange(axis, current, fallback);
  }

  /** Move `steps` slices (negative: down), one navigation voxel each. */
  stepSlice(viewType: ViewType, steps: number): void {
    const axis = AXIS[viewType];
    const range = this.getSliceRange(viewType);
    const crosshair = useViewStateStore.getState().viewState.crosshair.world_mm;
    const next = steppedSlicePosition(range, crosshair, axis, steps);
    if (!Object.is(next, crosshair[axis])) this.updateSlicePosition(viewType, next);
  }

  updateSlicePosition(viewType: ViewType, worldPosition: number): void {
    if (!Number.isFinite(worldPosition)) return;
    const { min, max } = this.getSliceRange(viewType);
    const position = Math.max(min, Math.min(max, worldPosition));
    const axis = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;
    const state = useViewStateStore.getState();
    if (state.viewState.crosshair.world_mm[axis] === position) return;
    const crosshair: [number, number, number] = [...state.viewState.crosshair.world_mm];
    crosshair[axis] = position;
    void state.setCrosshair(crosshair, true, true).catch(error => {
      console.error('[SliceNavigationService] Failed to update crosshair:', error);
    });
  }
}
/**
 * One voxel step along world `axis`, from a column-major `voxelToWorld`: the
 * projection onto the axis of the voxel axis most aligned with it. For a
 * permuted grid (voxel i along world Y) that voxel axis is not `axis` itself.
 */
function worldAxisStep(voxelToWorld: readonly number[] | undefined, axis: 0 | 1 | 2): number | null {
  if (!voxelToWorld || voxelToWorld.length < 16) return null;
  let best: number | null = null;
  let bestAlignment = 0;
  for (let column = 0; column < 3; column += 1) {
    const v = [0, 1, 2].map((row) => voxelToWorld[column * 4 + row]);
    const length = Math.hypot(...v);
    if (!Number.isFinite(length) || length === 0) continue;
    const alignment = Math.abs(v[axis]) / length;
    if (alignment > bestAlignment + 1e-9) {
      bestAlignment = alignment;
      best = Math.abs(v[axis]);
    }
  }
  return best !== null && best > 1e-9 ? best : null;
}

/**
 * Slice range along a world axis from a layer's metadata (voxel-centre bounds,
 * one voxel per step). Shared by the orthogonal views and Compare panels.
 */
export function sliceRangeForMetadata(
  metadata:
    | (Pick<VolumeMetadata, 'worldBounds' | 'dimensions' | 'spacing'> &
        Partial<Pick<VolumeMetadata, 'voxelToWorld'>>)
    | undefined,
  axis: 0 | 1 | 2,
  current: number,
): SliceRange {
  const bounds = metadata?.worldBounds;
  if (!bounds || !Number.isFinite(bounds.min[axis]) || !Number.isFinite(bounds.max[axis])) {
    return { min: -100, max: 100, step: 1, current };
  }
  const min = Math.min(bounds.min[axis], bounds.max[axis]);
  const max = Math.max(bounds.min[axis], bounds.max[axis]);
  // The affine gives the step along the world axis; the voxel count along
  // voxel axis `axis` is only right when the grid is not permuted.
  const count = metadata?.dimensions?.[axis];
  const spacing =
    worldAxisStep(metadata?.voxelToWorld, axis) ??
    (count && count > 1 ? (max - min) / (count - 1) : metadata?.spacing?.[axis]);
  const step = spacing && Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
  return { min, max, step, current };
}

let service: SliceNavigationService | null = null;
export function getSliceNavigationService(): SliceNavigationService {
  return service ??= new SliceNavigationService();
}
