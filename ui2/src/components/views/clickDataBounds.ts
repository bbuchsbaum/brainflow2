/**
 * Click acceptance for slice views (Compare panels, Mosaic tiles and the
 * orthogonal views): a click places the crosshair only when it lands on the
 * image data, not in the letterbox, panel margin or tile padding around it.
 *
 * The click-to-world mapping is unchanged (hover == click == crosshair,
 * slicePlacementAgreement.test.ts); this only decides whether the mapped
 * point is accepted. The data rectangle is the volume's outer voxel edges
 * (voxel-centre bounds widened by half a voxel), the same extent the
 * crosshair stroke is clipped to, tested on the plane's in-plane axes only.
 */
import { useMemo } from 'react';
import { useLayerStore, type VolumeMetadata } from '@/stores/layerStore';

type Vec3 = [number, number, number];

export interface WorldBox {
  min: Vec3;
  max: Vec3;
}

interface PlaneBasis {
  u_mm: readonly number[];
  v_mm: readonly number[];
}

/** The volume's outer voxel edges: voxel-centre bounds widened by half a voxel. */
export function volumeEdgeBounds(
  metadata: Pick<VolumeMetadata, 'worldBounds' | 'dimensions' | 'spacing'> | null | undefined,
): WorldBox | null {
  const b = metadata?.worldBounds;
  if (!b) return null;
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a += 1) {
    const lo = Math.min(b.min[a], b.max[a]);
    const hi = Math.max(b.min[a], b.max[a]);
    const n = metadata?.dimensions?.[a];
    const sp = n && n > 1 ? (hi - lo) / (n - 1) : (metadata?.spacing?.[a] ?? 0);
    const half = Number.isFinite(sp) && sp > 0 ? sp / 2 : 0;
    min[a] = lo - half;
    max[a] = hi + half;
  }
  return { min, max };
}

/** Smallest box holding every given box (null when none is given). */
export function unionWorldBoxes(
  boxes: ReadonlyArray<WorldBox | null | undefined>,
): WorldBox | null {
  let out: WorldBox | null = null;
  for (const box of boxes) {
    if (!box) continue;
    if (!out) {
      out = { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
      continue;
    }
    for (let a = 0; a < 3; a += 1) {
      out.min[a] = Math.min(out.min[a], box.min[a]);
      out.max[a] = Math.max(out.max[a], box.max[a]);
    }
  }
  return out;
}

/** World axes lying in the plane (the slice normal's own axis excluded). */
function inPlaneAxes(plane: PlaneBasis): [boolean, boolean, boolean] {
  const u = plane.u_mm;
  const v = plane.v_mm;
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const n = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(n > 0)) return [true, true, true];
  return normal.map((c) => Math.abs(c / n) < 0.9) as [boolean, boolean, boolean];
}

/**
 * True when a mapped click lies on the data: inside `bounds` on the plane's
 * in-plane axes. No bounds (metadata not known yet) accepts the click.
 */
export function isClickOnData(
  world: readonly number[],
  plane: PlaneBasis | null | undefined,
  bounds: WorldBox | null | undefined,
  toleranceMm = 1e-3,
): boolean {
  if (!bounds || !plane) return true;
  if (!world.every((c) => Number.isFinite(c))) return false;
  const axes = inPlaneAxes(plane);
  for (let a = 0; a < 3; a += 1) {
    if (!axes[a]) continue;
    if (world[a] < bounds.min[a] - toleranceMm || world[a] > bounds.max[a] + toleranceMm) {
      return false;
    }
  }
  return true;
}

/** Union of the given layers' outer voxel edges (null until metadata arrives). */
export function useLayerEdgeBounds(layerIds: readonly string[]): WorldBox | null {
  // A primitive key keeps the selector stable across unrelated store updates.
  const key = useLayerStore((state) => {
    const box = unionWorldBoxes(
      layerIds.map((id) => volumeEdgeBounds(state.layerMetadata.get(id))),
    );
    return box ? `${box.min.join(',')}|${box.max.join(',')}` : '';
  });
  return useMemo(() => {
    if (!key) return null;
    const [min, max] = key.split('|').map((part) => part.split(',').map(Number) as Vec3);
    return { min, max };
  }, [key]);
}
