/**
 * useAtlasMenuListener - listens for quick atlas preset menu actions from Tauri
 * and directly loads the selected atlas as an overlay layer on top of the
 * existing volume(s), without opening the AtlasPanel sidebar.
 *
 * Context-aware loading:
 * - If a surface view/panel is active AND surfaces are loaded → project to surface
 * - Otherwise → load as volume layer
 */

import { useEffect } from 'react';
import { nanoid } from 'nanoid';
import { isNoopUnlisten, safeListen } from '@/utils/eventUtils';
import { AtlasService } from '@/services/AtlasService';
import { getVolumeSurfaceProjectionService } from '@/services/VolumeSurfaceProjectionService';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useLayerStore } from '@/stores/layerStore';
import { AtlasCategory } from '@/types/atlas';
import type { AtlasConfig, SurfaceAtlasLoadResult } from '@/types/atlas';
import type { DisplayLayer } from '@/types/displayLayer';
import { getEventBus } from '@/events/EventBus';
import { getLayoutService } from '@/services/layoutService';
import { withTimeout } from '@/utils/withTimeout';
import { normalizeLateralHemisphere } from '@/utils/surfaceIdentity';
import {
  buildLabelRgbaFromLabelInfo,
} from './atlasSurfaceColorUtils';

interface AtlasPresetPayload {
  atlas_id: string;
  space?: string;
  resolution?: string;
  networks?: number;
  parcels?: number;
  data_type?: string;
  surf_type?: string;
}

interface AtlasMenuActionEvent {
  action: 'load-atlas-preset' | 'load-atlas' | 'load-surface-atlas-preset';
  payload: AtlasPresetPayload;
}

let atlasMenuListenerInitialized = false;
let atlasMenuListenerSetupInFlight = false;
let atlasMenuListenerWarnedPending = false;

const PALETTE_TIMEOUT_MS = 10_000;

function formatElapsedMs(startMs: number): number {
  return Math.round(Date.now() - startMs);
}

function countUniquePositiveLabels(labels: number[]): number {
  const unique = new Set<number>();
  for (const label of labels) {
    if (label > 0) {
      unique.add(label);
    }
  }
  return unique.size;
}

function buildSurfaceParcelDataJson(
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

function inferPreferredSurfaceType(requested?: string): string {
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

/**
 * Ensure an fsaverage hemisphere surface is loaded, loading it if necessary.
 * Returns the surface ID or null if loading failed.
 */
async function ensureFsaverageSurface(
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
      console.error('[useAtlasMenuListener] Loaded fsaverage surface vertex count mismatch', {
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
  console.log(`[useAtlasMenuListener] Auto-loading fsaverage ${surfType} ${hemisphere}...`);
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
      console.warn('[useAtlasMenuListener] Retrying hemisphere load with pial fallback', {
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
    console.error(`[useAtlasMenuListener] Failed to auto-load fsaverage ${hemisphere}:`, err);
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
function applySurfaceAtlasOverlay(
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
    console.error('[useAtlasMenuListener] Surface/atlas vertex mismatch, skipping overlay', {
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
  const { addDataLayer, upsertDisplayLayer } = useSurfaceStore.getState();

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

  const displayLayer: DisplayLayer = {
    id: layerId,
    name: atlasName,
    type: 'label',
    visible: true,
    opacity: 1.0,
    colormap: 'categorical',
    intensity: [0, maxLabel] as [number, number],
  };
  upsertDisplayLayer(surfaceId, displayLayer);

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
async function handleSurfaceAtlasPreset(
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
    '[useAtlasMenuListener] loadSurfaceAtlas finished in',
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
  console.log('[useAtlasMenuListener] Surface atlas label summary:', {
    atlas: config.atlas_id,
    parcelsRequested: config.parcels,
    networksRequested: config.networks,
    uniqueLh,
    uniqueRh,
    uniqueCombined,
  });
  if (config.parcels && uniqueCombined < config.parcels) {
    console.warn('[useAtlasMenuListener] Atlas returned fewer unique labels than requested parcels', {
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
      console.warn('[useAtlasMenuListener] Could not load fsaverage left hemisphere');
    }
  }

  if (result.labels_rh.length > 0) {
    const rhId = await ensureFsaverageSurface('right', surfType, eventBus, result.n_vertices_rh);
    if (rhId) {
      hemisphereResults.push({ surfaceId: rhId, labels: result.labels_rh, side: 'RH' });
    } else {
      console.warn('[useAtlasMenuListener] Could not load fsaverage right hemisphere');
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
      console.log('[useAtlasMenuListener] Registered surface atlas parcel reference', {
        referenceId: parcellationReferenceId,
        atlasId: config.atlas_id,
        parcelRows: reference.parcel_row_count,
      });
    } catch (error) {
      console.warn('[useAtlasMenuListener] Failed to register parcel reference for surface atlas', {
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

export function useAtlasMenuListener() {
  useEffect(() => {
    if (atlasMenuListenerInitialized || atlasMenuListenerSetupInFlight) {
      console.log('[useAtlasMenuListener] Listener already initialized, skipping');
      return;
    }

    console.log('[useAtlasMenuListener] Setting up atlas menu listener...');

    const setupListener = async () => {
      if (atlasMenuListenerInitialized || atlasMenuListenerSetupInFlight) {
        return;
      }
      atlasMenuListenerSetupInFlight = true;

      try {
        const unlisten = await safeListen<AtlasMenuActionEvent>('atlas-menu-action', async (event) => {
          console.log('[useAtlasMenuListener] Atlas menu action received:', event.payload);

          const action = event.payload.action;

          if (action !== 'load-atlas-preset' && action !== 'load-atlas' && action !== 'load-surface-atlas-preset') {
            console.warn('[useAtlasMenuListener] Unknown atlas action:', action);
            return;
          }

          const payload = event.payload.payload;
          if (!payload?.atlas_id) {
            console.warn('[useAtlasMenuListener] Missing atlas_id in payload');
            return;
          }

          const eventBus = getEventBus();

          // ── Surface Atlas Path ─────────────────────────────────────
          if (action === 'load-surface-atlas-preset') {
            try {
              await handleSurfaceAtlasPreset(payload, eventBus);
            } catch (error) {
              console.error('[useAtlasMenuListener] Failed to load surface atlas preset:', error);
              eventBus.emit('ui.notification', {
                type: 'error',
                message:
                  error instanceof Error
                    ? `Failed to load surface atlas: ${error.message}`
                    : 'Failed to load surface atlas preset.',
              });
            }
            return;
          }

          // ── Volume Atlas Path ──────────────────────────────────────
          try {
            // Look up atlas entry to derive defaults
            const entry = await AtlasService.getAtlasEntry(payload.atlas_id);
            if (!entry) {
              console.warn('[useAtlasMenuListener] No catalog entry found for preset atlas', payload.atlas_id);
              eventBus.emit('ui.notification', {
                type: 'error',
                message: `Atlas preset '${payload.atlas_id}' is not available in the current catalog.`,
              });
              return;
            }

            const config: AtlasConfig = {
              atlas_id: entry.id,
              space: payload.space || entry.allowed_spaces[0]?.id || '',
              resolution: payload.resolution || entry.resolutions[0]?.value || '',
              networks: payload.networks ?? entry.network_options?.[0],
              parcels: payload.parcels ?? entry.parcel_options?.[0],
              template_params: undefined,
            };

            // Validate configuration before loading
            const isValid = await AtlasService.validateConfig(config);
            if (!isValid) {
              eventBus.emit('ui.notification', {
                type: 'error',
                message: `Invalid atlas configuration for '${entry.name}'.`,
              });
              return;
            }

            // Check if we should load to surface or volume based on context
            const activePanel = useActivePanelStore.getState().componentType;
            const surfaceState = useSurfaceStore.getState();
            const isSurfaceContext = activePanel === 'SurfacePanel' || activePanel === 'surfaceView';
            const hasSurfaces = surfaceState.surfaces.size > 0;
            const activeSurfaceId =
              surfaceState.activeSurfaceId ?? surfaceState.surfaces.keys().next().value ?? null;
            const hasVolumeLayers = useLayerStore.getState().layers.length > 0;

            // Only cortical atlases are candidates for surface projection
            const isSurfaceProjectable = entry.category === AtlasCategory.Cortical;

            let shouldProjectToSurface = false;
            if (isSurfaceProjectable && hasSurfaces && activeSurfaceId && isSurfaceContext) {
              // Ask user whether to project onto surface or load as volume
              const projectToSurface = window.confirm(
                `"${entry.name}" — Project onto active surface?\n\nOK = Project to surface\nCancel = Load as volume overlay`
              );
              shouldProjectToSurface = projectToSurface;
            } else if (!isSurfaceProjectable && isSurfaceContext && hasSurfaces) {
              // Non-cortical atlas in surface context: notify user it can only load as volume
              eventBus.emit('ui.notification', {
                type: 'info',
                message: `Loading '${entry.name}' as volume (not projectable to cortical surface).`,
              });
            }

            console.log('[useAtlasMenuListener] Context decision:', {
              activePanel,
              isSurfaceContext,
              hasSurfaces,
              activeSurfaceId,
              hasVolumeLayers,
              isSurfaceProjectable,
              shouldProjectToSurface,
            });

            if (shouldProjectToSurface) {
              // Surface context: load atlas then project to surface
              const tLoadAtlas = Date.now();
              console.log('[useAtlasMenuListener] Loading atlas for surface projection...', config);
              const result = await AtlasService.loadAtlas(config);
              console.log('[useAtlasMenuListener] loadAtlas finished in', formatElapsedMs(tLoadAtlas), 'ms', {
                success: result.success,
                volume_handle: result.volume_handle,
                error_message: result.error_message,
              });

              if (!result.success || !result.volume_handle) {
                const msg = result.error_message || `Atlas '${entry.name}' failed to load.`;
                eventBus.emit('ui.notification', {
                  type: 'error',
                  message: msg,
                });
                return;
              }

              // Project to active surface
              const projectionService = getVolumeSurfaceProjectionService();
              const atlasName = entry.name + (config.parcels ? ` (${config.parcels}p)` : '');

              eventBus.emit('ui.notification', {
                type: 'info',
                message: `Projecting '${atlasName}' onto surface…`,
              });

              let palette = null as Awaited<ReturnType<typeof AtlasService.getAtlasPalette>> | null;
              try {
                const tPalette = Date.now();
                console.log('[useAtlasMenuListener] Fetching atlas palette...', {
                  atlas_id: config.atlas_id,
                  space: config.space,
                  resolution: config.resolution,
                  parcels: config.parcels,
                  networks: config.networks,
                });
                palette = await withTimeout(
                  AtlasService.getAtlasPalette(config),
                  PALETTE_TIMEOUT_MS,
                  'AtlasService.getAtlasPalette'
                );
                console.log(
                  '[useAtlasMenuListener] getAtlasPalette finished in',
                  formatElapsedMs(tPalette),
                  'ms',
                  palette
                    ? { max_label: palette.lut.max_label, kind: palette.lut.kind, seed: palette.lut.seed }
                    : null
                );
              } catch (e) {
                console.warn('[useAtlasMenuListener] Atlas palette unavailable; falling back to continuous colormap:', e);
                eventBus.emit('ui.notification', {
                  type: 'warning',
                  message: `Atlas palette unavailable; projecting '${atlasName}' with continuous colormap.`,
                });
              }

              const tProject = Date.now();
              await projectionService.projectAndDisplay(
                result.volume_handle,
                activeSurfaceId,
                atlasName,
                {
                  opacity: 1.0,
                  useGPUProjection: true,
                  ...(palette ? { atlasPalette: palette, atlasConfig: config } : { colormap: 'turbo' }),
                }
              );
              console.log('[useAtlasMenuListener] Surface projection finished in', formatElapsedMs(tProject), 'ms');

              eventBus.emit('ui.notification', {
                type: 'info',
                message: `Projected '${atlasName}' onto surface.`,
              });
            } else {
              // Volume context: load atlas and create volume layer
              const tLoad = Date.now();
              const { result, layer } = await AtlasService.loadAtlasAndCreateLayer(config);
              console.log('[useAtlasMenuListener] loadAtlasAndCreateLayer finished in', formatElapsedMs(tLoad), 'ms', {
                success: result.success,
                layerId: layer?.id ?? null,
                atlasName: result.atlas_metadata?.name,
              });

              if (!result.success || !result.volume_handle_info || !result.atlas_metadata) {
                const msg = result.error_message || `Atlas '${entry.name}' failed to load.`;
                eventBus.emit('ui.notification', {
                  type: 'error',
                  message: msg,
                });
                return;
              }

              eventBus.emit('ui.notification', {
                type: 'info',
                message: layer
                  ? `Loaded atlas '${result.atlas_metadata.name}' as overlay.`
                  : `Atlas '${result.atlas_metadata.name}' loaded without a visible layer.`,
              });
            }
          } catch (error) {
            console.error('[useAtlasMenuListener] Failed to load atlas preset:', error);
            const eventBus = getEventBus();
            eventBus.emit('ui.notification', {
              type: 'error',
              message:
                error instanceof Error
                  ? `Failed to load atlas: ${error.message}`
                  : 'Failed to load atlas preset.',
            });
          }
        });

        if (isNoopUnlisten(unlisten)) {
          if (!atlasMenuListenerWarnedPending) {
            console.warn(
              '[useAtlasMenuListener] atlas-menu listener not yet active; will retry setup'
            );
            atlasMenuListenerWarnedPending = true;
          }
          return;
        }

        atlasMenuListenerInitialized = true;
        atlasMenuListenerWarnedPending = false;
        console.log('[useAtlasMenuListener] Atlas menu listener setup complete');
      } catch (error) {
        atlasMenuListenerInitialized = false;
        console.error('[useAtlasMenuListener] Failed to setup atlas menu listener:', error);
      } finally {
        atlasMenuListenerSetupInFlight = false;
      }
    };

    void setupListener();

    const retryTimer =
      typeof window !== 'undefined'
        ? window.setInterval(() => {
            if (!atlasMenuListenerInitialized && !atlasMenuListenerSetupInFlight) {
              void setupListener();
            }
          }, 1500)
        : null;

    return () => {
      if (retryTimer !== null) {
        window.clearInterval(retryTimer);
      }
      // Do not tear down the singleton listener here; it is shared
      // across StrictMode mounts. Individual component unmounts should
      // not remove the global atlas-menu-action listener.
    };
  }, []);
}
