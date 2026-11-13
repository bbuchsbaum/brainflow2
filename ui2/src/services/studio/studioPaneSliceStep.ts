import type { ViewPlane } from '@/types/coordinates';
import { getVolumeApiService } from '@/services/volume/VolumeApiService';

type Axis = 'sagittal' | 'coronal' | 'axial';

/** The view axis a plane's normal points along (its dominant world axis). */
export function planeNormalAxis(plane: Pick<ViewPlane, 'u_mm' | 'v_mm'>): Axis | null {
  const u = plane.u_mm,
    v = plane.v_mm;
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const magnitudes = n.map(Math.abs);
  const largest = Math.max(...magnitudes);
  if (!(largest > 0)) return null;
  return (['sagittal', 'coronal', 'axial'] as const)[magnitudes.indexOf(largest)];
}

const cache = new Map<string, Promise<number | null>>();

/**
 * One slice step for a Studio pane showing `volumeId` on `plane`: the volume's
 * voxel spacing along the plane's normal (`query_slice_axis_meta`), so every
 * step shows a new slice. Null when it cannot be read (the caller steps 1 mm).
 * Cached per volume and axis; a failed read is not cached.
 */
export function studioPaneSliceStepMm(
  volumeId: string,
  plane: Pick<ViewPlane, 'u_mm' | 'v_mm'>,
): Promise<number | null> {
  const axis = planeNormalAxis(plane);
  if (!axis) return Promise.resolve(null);
  const key = `${volumeId}\u0000${axis}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = getVolumeApiService()
      .querySliceAxisMeta(volumeId, axis)
      .then(({ sliceSpacing }) =>
        Number.isFinite(sliceSpacing) && sliceSpacing > 0 ? sliceSpacing : null,
      )
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** Forget cached steps (tests; a volume id is never reused for other data). */
export function clearStudioPaneSliceSteps() {
  cache.clear();
}
