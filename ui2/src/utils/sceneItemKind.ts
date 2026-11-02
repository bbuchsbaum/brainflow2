import { moduleRegistry } from '@/modules/registry';
import type { SceneItemKind } from '@/types/sceneItem';

interface KindLayer {
  id: string;
  source?: string;
  layerKind?: string;
  type?: string;
  isLabelMap?: boolean;
}

/**
 * Atlas-like (categorical) volume: a catalogue atlas or a user-loaded label
 * map (NIfTI label intent or a label-table sidecar). Never the base.
 */
export function isAtlasLikeLayer(layer: KindLayer): boolean {
  const declared = moduleRegistry.getLayerKind(layer.layerKind);
  if (declared) return declared.baseRenderMode === 'label';
  return layer.source === 'atlas' || layer.isLabelMap === true || Boolean(layer.layerKind && layer.type === 'label');
}

/**
 * The Scene-stack kind of a volume layer: the single classifier shared by
 * the Scene stack and every selection that names a volume item. `layers`
 * is bottom first; the first non-atlas layer is the base.
 */
export function volumeSceneItemKind(
  layers: ReadonlyArray<KindLayer>,
  layerId: string,
): SceneItemKind | null {
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return null;
  if (isAtlasLikeLayer(layer)) return 'volume-overlay-atlas';
  const base = layers.find((l) => !isAtlasLikeLayer(l) && (moduleRegistry.getLayerKind(l.layerKind)?.stackingBand ?? 1) <= 2);
  return base?.id === layer.id ? 'volume-base' : 'volume-overlay';
}
