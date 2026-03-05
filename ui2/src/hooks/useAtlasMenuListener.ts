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
import { isNoopUnlisten, safeListen } from '@/utils/eventUtils';
import { AtlasService } from '@/services/AtlasService';
import { getVolumeSurfaceProjectionService } from '@/services/VolumeSurfaceProjectionService';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useLayerStore } from '@/stores/layerStore';
import { AtlasCategory } from '@/types/atlas';
import type { AtlasConfig } from '@/types/atlas';
import { getEventBus } from '@/events/EventBus';
import { withTimeout } from '@/utils/withTimeout';
import { formatElapsedMs } from './atlasMenuUtils';
import { handleSurfaceAtlasPreset } from './atlasMenuSurfaceLoader';
import type { AtlasMenuActionEvent } from './atlasMenuTypes';

let atlasMenuListenerInitialized = false;
let atlasMenuListenerSetupInFlight = false;
let atlasMenuListenerWarnedPending = false;

const PALETTE_TIMEOUT_MS = 10_000;

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
            await handleVolumeAtlasPreset(payload, eventBus);
          } catch (error) {
            console.error('[useAtlasMenuListener] Failed to load atlas preset:', error);
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
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Volume atlas loading handler
// ---------------------------------------------------------------------------

async function handleVolumeAtlasPreset(
  payload: AtlasMenuActionEvent['payload'],
  eventBus: ReturnType<typeof getEventBus>
): Promise<void> {
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
    const projectToSurface = window.confirm(
      `"${entry.name}" — Project onto active surface?\n\nOK = Project to surface\nCancel = Load as volume overlay`
    );
    shouldProjectToSurface = projectToSurface;
  } else if (!isSurfaceProjectable && isSurfaceContext && hasSurfaces) {
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
    await handleVolumeToSurfaceProjection(config, entry, activeSurfaceId!, eventBus);
  } else {
    await handleVolumeOverlay(config, entry, eventBus);
  }
}

async function handleVolumeToSurfaceProjection(
  config: AtlasConfig,
  entry: { name: string },
  activeSurfaceId: string,
  eventBus: ReturnType<typeof getEventBus>
): Promise<void> {
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
    eventBus.emit('ui.notification', { type: 'error', message: msg });
    return;
  }

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
}

async function handleVolumeOverlay(
  config: AtlasConfig,
  entry: { name: string },
  eventBus: ReturnType<typeof getEventBus>
): Promise<void> {
  const tLoad = Date.now();
  const { result, layer } = await AtlasService.loadAtlasAndCreateLayer(config);
  console.log('[useAtlasMenuListener] loadAtlasAndCreateLayer finished in', formatElapsedMs(tLoad), 'ms', {
    success: result.success,
    layerId: layer?.id ?? null,
    atlasName: result.atlas_metadata?.name,
  });

  if (!result.success || !result.volume_handle_info || !result.atlas_metadata) {
    const msg = result.error_message || `Atlas '${entry.name}' failed to load.`;
    eventBus.emit('ui.notification', { type: 'error', message: msg });
    return;
  }

  eventBus.emit('ui.notification', {
    type: 'info',
    message: layer
      ? `Loaded atlas '${result.atlas_metadata.name}' as overlay.`
      : `Atlas '${result.atlas_metadata.name}' loaded without a visible layer.`,
  });
}
