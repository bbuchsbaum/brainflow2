/**
 * Pure utility functions for atlas menu operations.
 */

import { useSurfaceStore } from '@/stores/surfaceStore';
import { normalizeLateralHemisphere } from '@/utils/surfaceIdentity';
import type { AtlasConfig, SurfaceAtlasLoadResult } from '@/types/atlas';

export function formatElapsedMs(startMs: number): number {
  return Math.round(Date.now() - startMs);
}

export function countUniquePositiveLabels(labels: number[]): number {
  const unique = new Set<number>();
  for (const label of labels) {
    if (label > 0) {
      unique.add(label);
    }
  }
  return unique.size;
}

export function buildSurfaceParcelDataJson(
  config: AtlasConfig,
  atlasName: string,
  labelInfo: SurfaceAtlasLoadResult['label_info']
): string | null {
  const seen = new Set<number>();
  const parcels: Array<Record<string, unknown>> = [];

  for (const entry of labelInfo) {
    const id = Math.trunc(entry.id ?? 0);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const record: Record<string, unknown> = {
      id,
      label: entry.name || `Parcel ${id}`,
      hemi: normalizeLateralHemisphere(entry.hemisphere),
    };

    if (entry.network) {
      record.network = entry.network;
    }

    parcels.push(record);
  }

  if (parcels.length === 0) {
    return null;
  }

  return JSON.stringify({
    schema_version: '1.0.0',
    atlas: {
      id: config.atlas_id,
      name: atlasName,
      space: config.space,
      class: 'surface',
      n_parcels: parcels.length,
    },
    parcels,
  });
}

export function inferPreferredSurfaceType(requested?: string): string {
  const allowed = new Set(['pial', 'white', 'inflated']);
  if (requested && allowed.has(requested)) {
    return requested;
  }

  const surfaceState = useSurfaceStore.getState();
  const activeSurface = surfaceState.activeSurfaceId
    ? surfaceState.surfaces.get(surfaceState.activeSurfaceId)
    : null;
  const activeType = activeSurface?.geometry?.surfaceType || activeSurface?.metadata?.surfaceType;
  if (activeType && allowed.has(activeType)) {
    return activeType;
  }

  for (const [, surface] of surfaceState.surfaces) {
    const candidate = surface.geometry?.surfaceType || surface.metadata?.surfaceType;
    if (candidate && allowed.has(candidate)) {
      return candidate;
    }
  }

  return 'pial';
}
