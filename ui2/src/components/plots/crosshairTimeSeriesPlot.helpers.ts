/**
 * Pure helpers for the crosshair time-series plot — extracted from the body
 * component so the body file can carry the react-refresh single-export
 * invariant. Both the body and the PlotMode binding consume these helpers.
 */

import { useLayerStore } from '@/stores/layerStore';
import { transformWorldToVoxelColumnMajor } from '@/utils/voxelTransform';

/** Minimum gap between successive `sample_voxel_timeseries` requests (ms). */
export const TIMESERIES_THROTTLE_MS = 34; // 1000/30 ≈ 33.3, rounded up to keep ≤30 Hz

export interface VoxelInfo {
  volumeId: string;
  voxel: [number, number, number];
}

/**
 * Resolve the active layer + crosshair to a voxel request payload, returning
 * `null` whenever sampling is not viable for any reason (3D layer, unset
 * crosshair, missing transform, out-of-bounds voxel). Both `supports` (mode)
 * and the body call this so gating is single-sourced.
 */
export function resolveTimeseriesVoxel(
  layerId: string | undefined,
  crosshairMm: readonly [number, number, number] | undefined,
): VoxelInfo | null {
  if (!layerId || !crosshairMm) return null;
  const state = useLayerStore.getState();
  const layer = state.getLayer(layerId);
  if (!layer) return null;

  const ts = (layer as typeof layer & { timeSeriesInfo?: { num_timepoints: number } })
    .timeSeriesInfo;
  if (!ts || ts.num_timepoints < 2) return null;

  const metadata = state.getLayerMetadata(layerId);
  if (!metadata?.worldToVoxel) return null;

  let voxelF: [number, number, number];
  try {
    voxelF = transformWorldToVoxelColumnMajor(metadata.worldToVoxel, [
      ...crosshairMm,
    ] as [number, number, number]);
  } catch {
    return null;
  }
  const vx = Math.round(voxelF[0]);
  const vy = Math.round(voxelF[1]);
  const vz = Math.round(voxelF[2]);

  if (metadata.dimensions) {
    const [dx, dy, dz] = metadata.dimensions;
    if (vx < 0 || vy < 0 || vz < 0 || vx >= dx || vy >= dy || vz >= dz) return null;
  }

  const volumeId = (layer as typeof layer & { volumeId?: string }).volumeId;
  if (!volumeId) return null;

  return { volumeId, voxel: [vx, vy, vz] };
}

/** Returns `true` when the active layer is 4D with at least 2 timepoints. */
export function isLayerFourD(layerId: string | undefined): boolean {
  if (!layerId) return false;
  const layer = useLayerStore.getState().getLayer(layerId);
  if (!layer) return false;
  const ts = (layer as typeof layer & { timeSeriesInfo?: { num_timepoints: number } })
    .timeSeriesInfo;
  return Boolean(ts && ts.num_timepoints >= 2);
}
