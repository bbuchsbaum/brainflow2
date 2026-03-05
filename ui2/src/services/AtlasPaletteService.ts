import { invoke } from '@tauri-apps/api/core';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { AtlasConfig } from '@/types/atlas';
import type { AtlasPaletteKind, AtlasPaletteResponse } from '@/types/atlasPalette';
import type { ViewLayer } from '@/types/viewState';
import { formatTauriError } from '@/utils/formatTauriError';

type VolumePalettePatch = Pick<
  ViewLayer,
  | 'colormapId'
  | 'intensity'
  | 'threshold'
  | 'interpolation'
  | 'atlasConfig'
  | 'atlasPaletteKind'
  | 'atlasPaletteSeed'
  | 'atlasMaxLabel'
>;

function buildAtlasPaletteKey(config: AtlasConfig, palette: AtlasPaletteResponse): string {
  const lut = palette.lut;
  return [
    'atlas_palette',
    config.atlas_id,
    config.space,
    config.resolution,
    config.parcels ?? 'none',
    config.networks ?? 'none',
    lut.kind,
    String(lut.seed),
    String(lut.max_label),
  ].join('|');
}

export class AtlasPaletteService {
  static async buildVolumePalettePatch(
    config: AtlasConfig,
    options?: { kind?: AtlasPaletteKind; seed?: number }
  ): Promise<VolumePalettePatch> {
    let palette: AtlasPaletteResponse;
    try {
      palette = await invoke<AtlasPaletteResponse>('plugin:api-bridge|get_atlas_palette', {
        config,
        kind: options?.kind,
        seed: options?.seed,
      });
    } catch (error) {
      throw new Error(`Failed to get atlas palette: ${formatTauriError(error)}`);
    }
    const key = buildAtlasPaletteKey(config, palette);

    let colormapId: number;
    try {
      colormapId = await invoke<number>('plugin:api-bridge|register_categorical_colormap', {
        key,
        maxLabel: palette.lut.max_label,
        lutRgb: palette.lut.lut_rgb,
      });
    } catch (error) {
      throw new Error(`Failed to register categorical colormap: ${formatTauriError(error)}`);
    }

    return {
      colormapId,
      intensity: [-0.5, palette.lut.max_label + 0.5],
      // Keep only label 0 suppressed (atlas background) and avoid mid-range filtering.
      threshold: [0, 0],
      interpolation: 'nearest',
      atlasConfig: config,
      atlasPaletteKind: palette.lut.kind,
      atlasPaletteSeed: palette.lut.seed,
      atlasMaxLabel: palette.lut.max_label,
    };
  }

  static async applyToVolumeLayer(
    layerId: string,
    config: AtlasConfig,
    options?: { kind?: AtlasPaletteKind; seed?: number }
  ): Promise<void> {
    const patch = await AtlasPaletteService.buildVolumePalettePatch(config, options);

    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;

      let didChange = false;

      if ((layer as any).colormapId !== patch.colormapId) {
        (layer as any).colormapId = patch.colormapId;
        didChange = true;
      }

      if (layer.interpolation !== patch.interpolation) {
        layer.interpolation = patch.interpolation;
        didChange = true;
      }

      const currentIntensity = layer.intensity;
      if (
        !currentIntensity ||
        currentIntensity[0] !== patch.intensity[0] ||
        currentIntensity[1] !== patch.intensity[1]
      ) {
        layer.intensity = patch.intensity;
        didChange = true;
      }

      const currentThreshold = layer.threshold;
      if (
        !currentThreshold ||
        currentThreshold[0] !== patch.threshold[0] ||
        currentThreshold[1] !== patch.threshold[1]
      ) {
        layer.threshold = patch.threshold;
        didChange = true;
      }

      if ((layer as any).atlasConfig !== patch.atlasConfig) {
        (layer as any).atlasConfig = patch.atlasConfig;
        didChange = true;
      }
      if ((layer as any).atlasPaletteKind !== patch.atlasPaletteKind) {
        (layer as any).atlasPaletteKind = patch.atlasPaletteKind;
        didChange = true;
      }
      if ((layer as any).atlasPaletteSeed !== patch.atlasPaletteSeed) {
        (layer as any).atlasPaletteSeed = patch.atlasPaletteSeed;
        didChange = true;
      }
      if ((layer as any).atlasMaxLabel !== patch.atlasMaxLabel) {
        (layer as any).atlasMaxLabel = patch.atlasMaxLabel;
        didChange = true;
      }

      if (!didChange) return;
    });
  }
}
