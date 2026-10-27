/**
 * A surface overlay's value at the crosshair: the nearest mesh vertex to the
 * crosshair (vertices are world mm, transform applied), when it lies within
 * `maxDistanceMm`. Used by the Scene rows of surface overlays (P3.10).
 *
 * An inflated or spherical mesh is not in the crosshair's space: its vertex
 * is found on the matching anatomical (pial / white) mesh of the same
 * topology (surfaceLink's cursor anatomy), and with none loaded there is no
 * reading (`anatomical: false`) rather than a wrong one (v4 function critic).
 */
import { useMemo } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { anatomicalMeshesFor } from '@/components/views/surfaceLink';

export interface SurfaceReading {
  vertex: number;
  value: number;
  distanceMm: number;
}

/** Nearest vertex of a flat xyz array to a point (null when empty). */
export function nearestVertex(
  vertices: ArrayLike<number>,
  point: readonly [number, number, number],
): { index: number; distanceMm: number } | null {
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0, v = 0; i + 2 < vertices.length; i += 3, v += 1) {
    const dx = vertices[i] - point[0];
    const dy = vertices[i + 1] - point[1];
    const dz = vertices[i + 2] - point[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = v;
    }
  }
  return best < 0 ? null : { index: best, distanceMm: Math.sqrt(bestD2) };
}

export interface SurfaceCrosshairReading {
  reading: SurfaceReading | null;
  /** False: no anatomical mesh to place the crosshair on (inflated / sphere alone). */
  anatomical: boolean;
}

export function useSurfaceValueAtCrosshair(
  surfaceId: string,
  surfaceLayerId: string,
  maxDistanceMm = 3,
): SurfaceCrosshairReading {
  const surface = useSurfaceStore((s) => s.surfaces.get(surfaceId));
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const crosshair = useViewStateStore((s) => s.viewState.crosshair.world_mm);
  // Every matching anatomical mesh (pial, white, midthickness...): the
  // vertex nearest the crosshair on ANY of them, not pial first (v5: a
  // crosshair on the white surface read the pial vertex).
  const meshes = useMemo(
    () => (surface ? anatomicalMeshesFor(surface, surfaces.values()) : []),
    [surface, surfaces],
  );
  const anatomy = meshes.length > 0 ? meshes : null;
  const reading = useMemo(() => {
    const layer = surface?.layers.get(surfaceLayerId);
    if (!layer || !anatomy || !layer.values?.length) return null;
    const point: [number, number, number] = [crosshair[0], crosshair[1], crosshair[2]];
    let hit: { index: number; distanceMm: number } | null = null;
    for (const vertices of anatomy) {
      const candidate = nearestVertex(vertices, point);
      if (candidate && (!hit || candidate.distanceMm < hit.distanceMm)) hit = candidate;
    }
    if (!hit || hit.distanceMm > maxDistanceMm) return null;
    // Sparse layers carry their vertex indices.
    let value: number | undefined;
    if (layer.indices) {
      const k = Array.prototype.indexOf.call(layer.indices, hit.index);
      value = k >= 0 ? layer.values[k] : undefined;
    } else {
      value = layer.values[hit.index];
    }
    if (value === undefined || !Number.isFinite(value)) return null;
    return { vertex: hit.index, value, distanceMm: hit.distanceMm };
  }, [surface, anatomy, surfaceLayerId, crosshair, maxDistanceMm]);
  return { reading, anatomical: anatomy !== null };
}
