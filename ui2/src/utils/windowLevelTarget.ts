import { resolveActiveLayer, type ActiveLayerSelection } from './activeLayer';

interface WindowLevelLayer {
  id: string;
  name?: string;
  visible: boolean;
  type?: string;
  source?: string;
  isLabelMap?: boolean;
}

/**
 * A layer with an intensity window: not a label map, atlas or binary mask.
 * A non-binary 'mask' (a template brain, GM/WM/CSF probability map) is an
 * intensity image and is windowed.
 */
export function hasIntensityWindow(
  layer: WindowLevelLayer,
  meta?: { isBinaryLike?: boolean },
): boolean {
  if (layer.type === 'label' || layer.isLabelMap === true || layer.source === 'atlas') return false;
  return layer.type !== 'mask' || meta?.isBinaryLike === false;
}

/**
 * The layer a right-drag window/level edits (QA §5, top issue #9: it edited
 * the bottom layer): the selected layer when it is visible and windowed,
 * else the topmost visible windowed layer. `layers` is bottom first.
 */
export function resolveWindowLevelLayer<T extends WindowLevelLayer>(
  layers: ReadonlyArray<T>,
  selection: ActiveLayerSelection | string | null | undefined,
  metadataOf: (id: string) => { isBinaryLike?: boolean } | undefined = () => undefined,
): T | null {
  const candidates = layers.filter(
    (layer) => layer.visible && hasIntensityWindow(layer, metadataOf(layer.id)),
  );
  return resolveActiveLayer(candidates, selection);
}
