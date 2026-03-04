import type { AtlasCatalogEntry, AtlasConfig, SurfaceAtlasLabelInfo } from '@/types/atlas';
import type { AtlasPaletteResponse } from '@/types/atlasPalette';

export function normalizePaletteResolution(resolution: string | undefined): string {
  return resolution === '1mm' || resolution === '2mm' ? resolution : '1mm';
}

export function fallbackColorForLabel(label: number): [number, number, number] {
  const r = (label * 67 + 29) % 256;
  const g = (label * 149 + 71) % 256;
  const b = (label * 223 + 113) % 256;
  return [r, g, b];
}

export function buildLabelRgbaFromLabelInfo(
  labels: ArrayLike<number>,
  labelInfo: SurfaceAtlasLabelInfo[]
): Float32Array {
  const colorMap = new Map<number, [number, number, number]>();
  for (const info of labelInfo) {
    if (info.color) {
      colorMap.set(info.id, info.color);
    }
  }

  const rgba = new Float32Array(labels.length * 4);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const color = colorMap.get(label) ?? (label > 0 ? fallbackColorForLabel(label) : undefined);
    const off = i * 4;
    if (color) {
      rgba[off] = color[0] / 255;
      rgba[off + 1] = color[1] / 255;
      rgba[off + 2] = color[2] / 255;
      rgba[off + 3] = label === 0 ? 0.0 : 1.0;
    } else {
      rgba[off + 3] = 0.0;
    }
  }
  return rgba;
}

export function buildLabelRgbaFromPalette(
  labels: ArrayLike<number>,
  palette: AtlasPaletteResponse
): Float32Array {
  const rgba = new Float32Array(labels.length * 4);
  const lutRgb = palette.lut.lut_rgb;
  const maxLabel = palette.lut.max_label;

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? 0;
    const off = i * 4;
    if (label <= 0) {
      rgba[off] = 0;
      rgba[off + 1] = 0;
      rgba[off + 2] = 0;
      rgba[off + 3] = 0;
      continue;
    }

    const clamped = Math.max(0, Math.min(maxLabel, Math.round(label)));
    const lutOff = clamped * 3;
    rgba[off] = (lutRgb[lutOff] ?? 0) / 255;
    rgba[off + 1] = (lutRgb[lutOff + 1] ?? 0) / 255;
    rgba[off + 2] = (lutRgb[lutOff + 2] ?? 0) / 255;
    rgba[off + 3] = 1;
  }

  return rgba;
}

export function buildSurfacePaletteCandidates(
  config: AtlasConfig,
  preferredResolution: string,
  atlasEntry: AtlasCatalogEntry | null
): AtlasConfig[] {
  const paletteCandidates: AtlasConfig[] = [];
  const seenPaletteCandidates = new Set<string>();

  const pushPaletteCandidate = (space: string, resolution: string) => {
    if (!space) return;
    const normalizedResolution = normalizePaletteResolution(resolution);
    const key = `${space}|${normalizedResolution}`;
    if (seenPaletteCandidates.has(key)) return;
    seenPaletteCandidates.add(key);
    paletteCandidates.push({
      atlas_id: config.atlas_id,
      space,
      resolution: normalizedResolution,
      networks: config.networks,
      parcels: config.parcels,
    });
  };

  pushPaletteCandidate(config.space, preferredResolution);
  if (atlasEntry) {
    for (const spaceInfo of atlasEntry.allowed_spaces) {
      for (const resolutionInfo of atlasEntry.resolutions) {
        pushPaletteCandidate(spaceInfo.id, resolutionInfo.value);
      }
    }
  }
  pushPaletteCandidate(config.space, '1mm');
  pushPaletteCandidate(config.space, '2mm');

  return paletteCandidates;
}
