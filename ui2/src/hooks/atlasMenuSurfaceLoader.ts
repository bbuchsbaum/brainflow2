/**
 * Surface atlas loading, fsaverage surface provisioning, and overlay application.
 */

import { nanoid } from 'nanoid';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { AtlasService } from '@/services/AtlasService';
import { getEventBus } from '@/events/EventBus';
import { getLayoutService } from '@/services/layoutService';
import { normalizeLateralHemisphere } from '@/utils/surfaceIdentity';
import { buildLabelRgbaFromLabelInfo } from './atlasSurfaceColorUtils';
import {
  formatElapsedMs,
  countUniquePositiveLabels,
  buildSurfaceParcelDataJson,
  inferPreferredSurfaceType,
} from './atlasMenuUtils';
import type { AtlasPresetPayload } from './atlasMenuTypes';
import type { AtlasConfig, SurfaceAtlasLoadResult } from '@/types/atlas';

/**
 * Ensure an fsaverage hemisphere surface is loaded, loading it if necessary.
 * Returns the surface ID or null if loading failed.
 */
export async function ensureFsaverageSurface(
  hemisphere: 'left' | 'right',
  surfType: string,
  eventBus: ReturnType<typeof getEventBus>,
  expectedVertexCount: number
): Promise<string | null> {
  const surfaceState = useSurfaceStore.getState();

  // Check if a matching surface is already loaded
  for (const [id, surface] of surfaceState.surfaces) {
    const geo = surface.geometry;
    const path = surface.metadata?.path || '';
    const isFsaverageTemplate = path.startsWith('templateflow://fsaverage_');
    const normalizedHemisphere =
      normalizeLateralHemisphere(geo.hemisphere) ??
      normalizeLateralHemisphere(surface.metadata?.hemisphere);
    const normalizedSurfaceType = (geo.surfaceType || surface.metadata?.surfaceType || '').toLowerCase();
    const currentVertexCount =
      geo.vertices.length > 0 ? Math.floor(geo.vertices.length / 3) : (surface.metadata?.vertexCount || 0);
    const vertexCountMatches =
      expectedVertexCount <= 0 || currentVertexCount <= 0 || currentVertexCount === expectedVertexCount;

    if (
      isFsaverageTemplate &&
      vertexCountMatches &&
      normalizedHemisphere === hemisphere &&
      (normalizedSurfaceType === surfType || (!normalizedSurfaceType && surfType === 'pial'))
    ) {
      return id;
    }
  }

  const tryLoadSurface = async (geometryType: string): Promise<string | null> => {
    const surfaceLoadingService = getSurfaceLoadingService();
    const handle = await surfaceLoadingService.loadSurfaceTemplate({
      space: 'fsaverage',
      geometry_type: geometryType === 'pial' ? 'pial' : geometryType,
      hemisphere,
    }, {
      openViewer: false,
      focusSurfacePanel: false,
    });
    if (!handle) {
      return null;
    }

    const loadedSurface = useSurfaceStore.getState().surfaces.get(handle);
    const loadedVertexCount = loadedSurface
      ? loadedSurface.geometry.vertices.length > 0
        ? Math.floor(loadedSurface.geometry.vertices.length / 3)
        : (loadedSurface.metadata?.vertexCount || 0)
      : 0;
    if (
      expectedVertexCount > 0 &&
      loadedVertexCount > 0 &&
      loadedVertexCount !== expectedVertexCount
    ) {
      console.error('[atlasMenuSurfaceLoader] Loaded fsaverage surface vertex count mismatch', {
        hemisphere,
        surfType,
        expectedVertexCount,
        loadedVertexCount,
      });
      eventBus.emit('ui.notification', {
        type: 'error',
        message: `Loaded fsaverage ${hemisphere} surface has ${loadedVertexCount} vertices, expected ${expectedVertexCount}.`,
      });
      return null;
    }

    return handle ?? null;
  };

  // Not loaded – request it via the surface template loading service
  console.log(`[atlasMenuSurfaceLoader] Auto-loading fsaverage ${surfType} ${hemisphere}...`);
  eventBus.emit('ui.notification', {
    type: 'info',
    message: `Loading fsaverage ${surfType} (${hemisphere}) surface…`,
  });

  try {
    const primary = await tryLoadSurface(surfType);
    if (primary) {
      return primary;
    }

    if (surfType !== 'pial') {
      console.warn('[atlasMenuSurfaceLoader] Retrying hemisphere load with pial fallback', {
        hemisphere,
        requestedSurfType: surfType,
      });
      eventBus.emit('ui.notification', {
        type: 'warning',
        message: `Could not load fsaverage ${surfType} (${hemisphere}); retrying with pial.`,
      });
      return await tryLoadSurface('pial');
    }

    return null;
  } catch (err) {
    console.error(`[atlasMenuSurfaceLoader] Failed to auto-load fsaverage ${hemisphere}:`, err);
    if (surfType !== 'pial') {
      try {
        return await tryLoadSurface('pial');
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Add surface atlas per-vertex labels as a data overlay on a loaded surface.
 */
export function applySurfaceAtlasOverlay(
  surfaceId: string,
  labels: number[],
  labelInfo: SurfaceAtlasLoadResult['label_info'],
  atlasName: string,
  config: AtlasConfig,
  parcellationReferenceId?: string
): string | null {
  const surface = useSurfaceStore.getState().surfaces.get(surfaceId);
  const vertexCount = surface
    ? surface.geometry.vertices.length > 0
      ? Math.floor(surface.geometry.vertices.length / 3)
      : (surface.metadata?.vertexCount || 0)
    : 0;

  if (vertexCount > 0 && vertexCount !== labels.length) {
    console.error('[atlasMenuSurfaceLoader] Surface/atlas vertex mismatch, skipping overlay', {
      surfaceId,
      vertexCount,
      labels: labels.length,
      atlas: config.atlas_id,
      parcels: config.parcels,
      networks: config.networks,
    });
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: `Skipped '${atlasName}' overlay: surface vertex count (${vertexCount}) does not match atlas labels (${labels.length}).`,
    });
    return null;
  }

  const rgba = buildLabelRgbaFromLabelInfo(labels, labelInfo);
  const values = new Float32Array(labels.map(l => l));
  const labelsArray = new Uint32Array(labels);

  // Compute data range directly from surface labels.
  let maxLabel = 0;
  for (const l of labels) {
    if (l > maxLabel) maxLabel = l;
  }

  const layerId = nanoid();
  const { addDataLayer } = useSurfaceStore.getState();

  addDataLayer(surfaceId, {
    id: layerId,
    name: atlasName,
    values,
    colormap: 'categorical',
    range: [0, maxLabel] as [number, number],
    dataRange: [0, maxLabel] as [number, number],
    opacity: 1.0,
    rgba,
    labels: labelsArray,
    atlasConfig: config,
    parcellationReferenceId,
    atlasMaxLabel: maxLabel,
  });

  getEventBus().emit('surface.dataLayerAdded', {
    surfaceId,
    layerId,
  });
  getEventBus().emit('surface.overlayApplied', {
    surfaceId,
    layerId,
    colormap: 'categorical',
    range: [0, maxLabel] as [number, number],
    opacity: 1.0,
  });

  return layerId;
}

/**
 * Handle the 'load-surface-atlas-preset' action from the Atlases menu.
 */
export async function handleSurfaceAtlasPreset(
  payload: AtlasPresetPayload,
  eventBus: ReturnType<typeof getEventBus>
): Promise<void> {
  const surfType = inferPreferredSurfaceType(payload.surf_type);
  const atlasName =
    payload.atlas_id +
    (payload.parcels ? ` ${payload.parcels}p` : '') +
    (payload.networks ? ` ${payload.networks}N` : '');

  eventBus.emit('ui.notification', {
    type: 'info',
    message: `Loading surface atlas: ${atlasName}…`,
  });

  const config: AtlasConfig = {
    atlas_id: payload.atlas_id,
    space: payload.space || 'fsaverage',
    resolution: payload.resolution || 'surface',
    networks: payload.networks,
    parcels: payload.parcels,
    data_type: 'surface',
    surf_type: surfType,
  };

  // 1. Load surface atlas data from backend
  const tLoad = Date.now();
  const result: SurfaceAtlasLoadResult = await AtlasService.loadSurfaceAtlas(config);
  console.log(
    '[atlasMenuSurfaceLoader] loadSurfaceAtlas finished in',
    formatElapsedMs(tLoad),
    'ms',
    {
      space: result.space,
      n_vertices_lh: result.n_vertices_lh,
      n_vertices_rh: result.n_vertices_rh,
      n_labels: result.label_info.length,
    }
  );
  const uniqueLh = countUniquePositiveLabels(result.labels_lh);
  const uniqueRh = countUniquePositiveLabels(result.labels_rh);
  const uniqueCombined = countUniquePositiveLabels([
    ...result.labels_lh,
    ...result.labels_rh,
  ]);
  console.log('[atlasMenuSurfaceLoader] Surface atlas label summary:', {
    atlas: config.atlas_id,
    parcelsRequested: config.parcels,
    networksRequested: config.networks,
    uniqueLh,
    uniqueRh,
    uniqueCombined,
  });
  if (config.parcels && uniqueCombined < config.parcels) {
    console.warn('[atlasMenuSurfaceLoader] Atlas returned fewer unique labels than requested parcels', {
      requestedParcels: config.parcels,
      uniqueCombined,
      uniqueLh,
      uniqueRh,
    });
  }

  // 2. Ensure fsaverage surfaces are loaded for each hemisphere that has data
  const hemisphereResults: Array<{
    surfaceId: string;
    labels: number[];
    side: string;
  }> = [];

  if (result.labels_lh.length > 0) {
    const lhId = await ensureFsaverageSurface('left', surfType, eventBus, result.n_vertices_lh);
    if (lhId) {
      hemisphereResults.push({ surfaceId: lhId, labels: result.labels_lh, side: 'LH' });
    } else {
      console.warn('[atlasMenuSurfaceLoader] Could not load fsaverage left hemisphere');
    }
  }

  if (result.labels_rh.length > 0) {
    const rhId = await ensureFsaverageSurface('right', surfType, eventBus, result.n_vertices_rh);
    if (rhId) {
      hemisphereResults.push({ surfaceId: rhId, labels: result.labels_rh, side: 'RH' });
    } else {
      console.warn('[atlasMenuSurfaceLoader] Could not load fsaverage right hemisphere');
    }
  }

  if (hemisphereResults.length === 0) {
    eventBus.emit('ui.notification', {
      type: 'error',
      message: `No fsaverage surfaces could be loaded for atlas '${atlasName}'.`,
    });
    return;
  }

  // Ensure atlas-loaded hemispheres are visible by default.
  const { setSurfaceVisibility } = useSurfaceStore.getState();
  for (const { surfaceId } of hemisphereResults) {
    setSurfaceVisibility(surfaceId, true);
  }

  // Register parcel metadata once so palette switching can use the
  // parcellation-reference path instead of atlas rebuilds.
  let parcellationReferenceId: string | undefined;
  const parcelDataJson = buildSurfaceParcelDataJson(config, atlasName, result.label_info);
  if (parcelDataJson) {
    try {
      const reference = await AtlasService.importParcelDataJson(
        parcelDataJson,
        `surface_atlas:${config.atlas_id}`
      );
      parcellationReferenceId = reference.reference_id;
      console.log('[atlasMenuSurfaceLoader] Registered surface atlas parcel reference', {
        referenceId: parcellationReferenceId,
        atlasId: config.atlas_id,
        parcelRows: reference.parcel_row_count,
      });
    } catch (error) {
      console.warn('[atlasMenuSurfaceLoader] Failed to register parcel reference for surface atlas', {
        atlasId: config.atlas_id,
        error,
      });
    }
  }

  // 3. Apply per-vertex label overlays to each hemisphere
  const appliedLayers: Array<{ side: string; surfaceId: string; layerId: string }> = [];
  for (const { surfaceId, labels, side } of hemisphereResults) {
    const appliedLayerId = applySurfaceAtlasOverlay(
      surfaceId,
      labels,
      result.label_info,
      `${atlasName} (${side})`,
      config,
      parcellationReferenceId
    );
    if (appliedLayerId) {
      appliedLayers.push({ side, surfaceId, layerId: appliedLayerId });
    }
  }

  if (appliedLayers.length === 0) {
    eventBus.emit('ui.notification', {
      type: 'error',
      message: `Surface atlas '${atlasName}' loaded, but no compatible surface layer could be rendered.`,
    });
    return;
  }

  if (appliedLayers.length === 1) {
    eventBus.emit('ui.notification', {
      type: 'warning',
      message: `Loaded surface atlas '${atlasName}' on ${appliedLayers[0].side} only (other hemisphere unavailable).`,
    });
  }

  const currentActiveSurfaceId = useSurfaceStore.getState().activeSurfaceId;
  const visibleSurfaceId =
    (currentActiveSurfaceId && appliedLayers.some((entry) => entry.surfaceId === currentActiveSurfaceId)
      ? currentActiveSurfaceId
      : appliedLayers[0]?.surfaceId) ?? null;
  if (visibleSurfaceId && currentActiveSurfaceId !== visibleSurfaceId) {
    useSurfaceStore.getState().setActiveSurface(visibleSurfaceId);
  }

  if (visibleSurfaceId) {
    const layerForActiveSurface =
      appliedLayers.find((entry) => entry.surfaceId === visibleSurfaceId) ?? appliedLayers[0];
    if (layerForActiveSurface) {
      useSurfaceStore.getState().setSelectedItem('dataLayer', layerForActiveSurface.layerId);
    }
  }

  if (visibleSurfaceId) {
    const visibleSurfacePath = useSurfaceStore.getState().surfaces.get(visibleSurfaceId)?.metadata?.path;
    const layoutService = getLayoutService();
    layoutService.ensureSurfaceView(visibleSurfaceId, visibleSurfacePath);
    layoutService.focusSurfacePanel();
  }

  eventBus.emit('ui.notification', {
    type: 'success',
    message: `Loaded surface atlas '${atlasName}' on ${appliedLayers.map((s) => s.side).join(' + ')} (${uniqueCombined} unique labels).`,
  });
}
