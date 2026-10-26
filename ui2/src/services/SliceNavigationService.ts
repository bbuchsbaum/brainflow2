/** World-space slice navigation, using the reference volume's sampling grid. */
import type { ViewType } from '@/types/coordinates';
import { useLayerStore, type VolumeMetadata } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

export interface SliceRange { min: number; max: number; step: number; current: number; }

export class SliceNavigationService {
  getSliceRange(viewType: ViewType): SliceRange {
    const axis = viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1;
    const layers = useLayerStore.getState();
    const reference = layers.layers.find(layer => layer.visible);
    const metadata = reference ? layers.getLayerMetadata(reference.id) : undefined;
    const current = useViewStateStore.getState().viewState.crosshair.world_mm[axis];
    return sliceRangeForMetadata(metadata, axis, current);
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
 * Slice range along a world axis from a layer's metadata (voxel-centre bounds,
 * one voxel per step). Shared by the orthogonal views and Compare panels.
 */
export function sliceRangeForMetadata(
  metadata: Pick<VolumeMetadata, 'worldBounds' | 'dimensions' | 'spacing'> | undefined,
  axis: 0 | 1 | 2,
  current: number,
): SliceRange {
  const bounds = metadata?.worldBounds;
  if (!bounds || !Number.isFinite(bounds.min[axis]) || !Number.isFinite(bounds.max[axis])) {
    return { min: -100, max: 100, step: 1, current };
  }
  const min = Math.min(bounds.min[axis], bounds.max[axis]);
  const max = Math.max(bounds.min[axis], bounds.max[axis]);
  const count = metadata?.dimensions?.[axis];
  const spacing = count && count > 1 ? (max - min) / (count - 1) : metadata?.spacing?.[axis];
  const step = spacing && Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
  return { min, max, step, current };
}

let service: SliceNavigationService | null = null;
export function getSliceNavigationService(): SliceNavigationService {
  return service ??= new SliceNavigationService();
}
