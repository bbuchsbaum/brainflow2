/**
 * Atlas region lookup.
 *
 * Resolves the parcellation region under a world coordinate by sampling the
 * active atlas (label) layer and looking the sampled label id up in the layer's
 * cached palette legend (`LayerInfo.atlasPaletteLegend`, populated by
 * {@link AtlasPaletteService}). Shared by the crosshair-driven status-bar
 * readout and any hover-based consumer.
 */

import { useLayerStore, type LayerInfo } from "@/stores/layerStore";
import { sampleLayerAtWorld } from "./SamplingService";
import type { AtlasPaletteLegendEntry } from "@/types/atlasPalette";
import { sourceLabel } from "@/utils/logLabels";

export interface AtlasRegionHit {
  layerId: string;
  labelId: number;
  entry: AtlasPaletteLegendEntry;
}

/**
 * The atlas layer that names regions. `preferredLayerId` — the layer the
 * status bar's Layer/Value slots report — wins when it is itself a region
 * source, so Region never names a parcel from a different atlas than the
 * Value beside it. Otherwise the first label layer that carries atlas
 * metadata, mirroring the `activeAtlasId` heuristic used in the slice views.
 */
export function findActiveAtlasLayer(preferredLayerId?: string | null): LayerInfo | undefined {
  const layers = useLayerStore.getState().layers;
  if (preferredLayerId) {
    const preferred = layers.find((l) => l.id === preferredLayerId);
    if (preferred && isRegionSource(preferred)) return preferred;
  }
  return layers.find(isRegionSource) as LayerInfo | undefined;
}

/**
 * A layer that can name the region at a point: catalogue atlases carry
 * `atlasMetadata`; user-loaded label volumes with a label table carry only a
 * legend (LabelTableService).
 */
export function isRegionSource(l: Pick<LayerInfo, "type" | "atlasMetadata" | "atlasPaletteLegend">): boolean {
  return l.type === "label" && (!!l.atlasMetadata || (l.atlasPaletteLegend?.length ?? 0) > 0);
}

/** True when some layer can name regions (the status Region slot shows then). */
export function hasRegionSource(
  layers: ReadonlyArray<Pick<LayerInfo, "type" | "atlasMetadata" | "atlasPaletteLegend">>,
): boolean {
  return layers.some(isRegionSource);
}

/**
 * Resolve the atlas region at a world coordinate.
 *
 * Samples the parcellation's label value (nearest-voxel, so an exact integer
 * label id), rounds it, and looks it up in the layer legend. Returns null for
 * background (label 0), an unmapped id, a layer without a legend, or no atlas.
 */
export async function resolveAtlasRegionAtWorld(
  world: [number, number, number],
  preferredLayerId?: string | null,
): Promise<AtlasRegionHit | null> {
  const layers = useLayerStore.getState().layers;
  const preferred = preferredLayerId ? layers.find((l) => l.id === preferredLayerId) : undefined;
  // The reported layer is itself an atlas: its region only, never another
  // atlas's beside its Value.
  if (preferred && isRegionSource(preferred)) return regionInLayer(preferred, world);
  // Otherwise the first atlas with a region there (QA 2026-10-31: with
  // Glasser and ASEG loaded, Glasser has no label in the basal ganglia and
  // Region read "–" although ASEG names it).
  // One atlas failing to sample (evicted, being removed) does not end the
  // lookup: the next one may still name the region (review L7).
  const sources = layers.filter(isRegionSource);
  const failures: unknown[] = [];
  for (const layer of sources) {
    try {
      const hit = await regionInLayer(layer, world);
      if (hit) return hit;
    } catch (error) {
      failures.push(error);
    }
  }
  // Every atlas failed: report it, as a single-atlas lookup does.
  if (sources.length > 0 && failures.length === sources.length) throw failures[0];
  return null;
}

async function regionInLayer(
  layer: LayerInfo,
  world: [number, number, number],
): Promise<AtlasRegionHit | null> {
  const legend = layer.atlasPaletteLegend;
  if (!legend || legend.length === 0) return null;
  const sample = await sampleLayerAtWorld({ layerId: layer.id, world });
  if (sample.value === null || !Number.isFinite(sample.value)) return null;
  const labelId = Math.round(sample.value);
  if (labelId <= 0) return null; // background / outside any parcel
  const entry = legend.find((e) => e.label_id === labelId);
  return entry ? { layerId: layer.id, labelId, entry } : null;
}

/**
 * Compact, human-readable region label for the status bar, e.g.
 * "LH VisCent ExStr 1". Underscores in the ROI name become spaces; the
 * hemisphere is prefixed as LH/RH when known. User-supplied label tables set
 * `displayName`, which is shown verbatim.
 */
export function formatRegionLabel(entry: AtlasPaletteLegendEntry): string {
  if (entry.displayName) return entry.displayName;
  const hemi =
    entry.hemisphere === "left"
      ? "LH"
      : entry.hemisphere === "right"
        ? "RH"
        : "";
  const name = entry.roi.replace(/_/g, " ");
  return [hemi, name].filter(Boolean).join(" ");
}

/**
 * The status bar's Region text. When the region comes from an atlas other
 * than the reported layer (a z map is selected, so the first atlas answers),
 * the atlas is named: "LH Pallidum · aseg.nii.gz" (QA 2026-10-30 F49).
 */
export function regionReadoutText(hit: AtlasRegionHit, reportedLayerId?: string | null): string {
  const label = formatRegionLabel(hit.entry);
  if (!reportedLayerId || hit.layerId === reportedLayerId) return label;
  const atlas = useLayerStore.getState().layers.find((layer) => layer.id === hit.layerId);
  const name = atlas ? sourceLabel(atlas.sourcePath, atlas.name, atlas.id) : "";
  return name ? `${label} · ${name}` : label;
}
