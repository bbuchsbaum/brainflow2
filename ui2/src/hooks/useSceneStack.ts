import { useMemo } from 'react';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useSurfaceStore, type LoadedSurface, type SurfaceDataLayer } from '@/stores/surfaceStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SceneItem, SceneStackGroups } from '@/types/sceneItem';

/**
 * Unified, derived read view of all scene-stack items used by the right
 * Inspector. Fans out across `layerStore` (volumes), `surfaceStore`
 * (surfaces + per-surface data layers), and `viewStateStore` (current
 * render properties — opacity, atlas tagging, etc.).
 *
 * The shape returned is the contract that `<SceneStack />` renders. Atlas
 * detection uses `layer.source === 'atlas'` or the presence of
 * `layer.atlasMetadata`; vol2surf mappings are derived from
 * `SurfaceDataLayer.volumeId`.
 */
export function useSceneStack(): SceneStackGroups {
  const volumeLayers = useLayerStore((state) => state.layers);
  const surfaces = useSurfaceStore((state) => state.surfaces);
  const viewStateLayers = useViewStateStore(
    (state) => state.viewState?.layers ?? null
  );

  return useMemo(
    () => buildSceneStack(volumeLayers, surfaces, viewStateLayers),
    [volumeLayers, surfaces, viewStateLayers]
  );
}

/**
 * Pure builder so this is testable without React.
 */
export function buildSceneStack(
  volumeLayers: LayerInfo[],
  surfaces: Map<string, LoadedSurface>,
  viewStateLayers: ReadonlyArray<{ id: string; render?: { opacity?: number } }> | null
): SceneStackGroups {
  const opacityById = new Map<string, number>();
  if (viewStateLayers) {
    for (const vl of viewStateLayers) {
      if (vl.render?.opacity !== undefined) {
        opacityById.set(vl.id, vl.render.opacity);
      }
    }
  }

  // The first non-atlas volume is the "base" (anatomical reference); every
  // other non-atlas volume is an overlay. Atlas-tagged volumes are always
  // labeled `volume-overlay-atlas` regardless of position.
  //
  // Atlas detection: ONLY `source === 'atlas'` (an explicit signal from
  // AtlasService.load_atlas_with_palette). The presence of `atlasMetadata`
  // alone is too aggressive — parcellations loaded as regular volumes
  // (e.g. Schaefer600.nii.gz dragged in) should keep full overlay controls
  // (intensity, threshold, colormap), not the atlas-only stripped variant.
  let baseClaimed = false;
  const volumes: SceneItem[] = volumeLayers.map((layer) => {
    const isAtlas = layer.source === 'atlas';
    let kind: SceneItem['kind'];
    if (isAtlas) {
      kind = 'volume-overlay-atlas';
    } else if (!baseClaimed) {
      kind = 'volume-base';
      baseClaimed = true;
    } else {
      kind = 'volume-overlay';
    }
    return {
      id: layer.id,
      kind,
      group: 'volume',
      name: layer.name,
      subtitle: buildVolumeSubtitle(
        layer,
        kind as 'volume-base' | 'volume-overlay' | 'volume-overlay-atlas'
      ),
      visible: layer.visible,
      opacity: opacityById.get(layer.id) ?? 1,
      ref: { type: 'volume', layerId: layer.id },
    } satisfies SceneItem;
  });

  const surfaceItems: SceneItem[] = [];
  const mappingItems: SceneItem[] = [];

  for (const [surfaceId, surface] of surfaces.entries()) {
    surfaceItems.push({
      id: surfaceId,
      kind: 'surface-geometry',
      group: 'surface',
      name: surface.name,
      subtitle: buildSurfaceSubtitle(surface),
      visible: surface.visible,
      opacity: 1,
      ref: { type: 'surface-geometry', surfaceId },
    });

    for (const [surfaceLayerId, dataLayer] of surface.layers.entries()) {
      const itemId = `${surfaceId}::${surfaceLayerId}`;
      surfaceItems.push({
        id: itemId,
        kind: 'surface-overlay',
        group: 'surface',
        name: dataLayer.name,
        subtitle: buildSurfaceOverlaySubtitle(dataLayer),
        visible: dataLayer.visible !== false,
        opacity: dataLayer.opacity ?? 1,
        ref: {
          type: 'surface-overlay',
          surfaceId,
          surfaceLayerId,
        },
      });

      if (dataLayer.volumeId) {
        const source = volumeLayers.find((v) => v.id === dataLayer.volumeId);
        const method = surface.metadata.mappingOptions?.method ?? 'projection';
        mappingItems.push({
          id: `mapping::${surfaceId}::${surfaceLayerId}`,
          kind: 'mapping',
          group: 'mapping',
          name: `${source?.name ?? dataLayer.volumeId} → ${surface.name}`,
          subtitle: `volume-to-surface · ${method}`,
          visible: dataLayer.visible !== false,
          opacity: dataLayer.opacity ?? 1,
          ref: {
            type: 'mapping',
            surfaceId,
            surfaceLayerId,
            volumeId: dataLayer.volumeId,
          },
        });
      }
    }
  }

  return {
    volumes,
    surfaces: surfaceItems,
    mappings: mappingItems,
    totalCount: volumes.length + surfaceItems.length + mappingItems.length,
  };
}

function buildVolumeSubtitle(
  layer: LayerInfo,
  kind: 'volume-base' | 'volume-overlay' | 'volume-overlay-atlas'
): string {
  const parts: string[] = [];

  if (kind === 'volume-base') {
    parts.push('base volume');
  } else if (kind === 'volume-overlay-atlas') {
    parts.push('label overlay');
  } else {
    parts.push('volume overlay');
  }

  if (layer.atlasMetadata?.n_regions) {
    parts.push(`${layer.atlasMetadata.n_regions} regions`);
  }

  if (layer.volumeType === 'TimeSeries4D' && layer.timeSeriesInfo) {
    const total = layer.timeSeriesInfo.num_timepoints;
    const current = layer.currentTimepoint ?? 0;
    parts.push(`frame ${current}/${total}`);
  }

  if (layer.atlasMetadata?.space) {
    parts.push(layer.atlasMetadata.space);
  }

  return parts.join(' · ');
}

function buildSurfaceSubtitle(surface: LoadedSurface): string {
  const parts: string[] = ['surface geometry'];
  if (surface.metadata.vertexCount) {
    parts.push(`${formatVertices(surface.metadata.vertexCount)} vertices`);
  }
  if (surface.metadata.hemisphere) {
    parts.push(surface.metadata.hemisphere);
  }
  return parts.join(' · ');
}

function buildSurfaceOverlaySubtitle(layer: SurfaceDataLayer): string {
  const parts: string[] = ['surface overlay'];
  if (layer.volumeId) {
    parts.push('from volume');
  }
  if (layer.colormap) {
    parts.push(layer.colormap);
  }
  return parts.join(' · ');
}

function formatVertices(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}k`;
  }
  return `${count}`;
}
