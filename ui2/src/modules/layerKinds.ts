/** Shared interpretation of module layer declarations for core services. */
import type { Layer } from '@/types/layers';
import type { LayerBaseRenderMode } from './api';
import { moduleRegistry } from './registry';

/**
 * The shader path a layer is drawn with. 'mask' is a flat white fill of the
 * non-zero voxels that ignores the colormap and the intensity window, so it
 * is only for a true {0, 1} image. A layer typed 'mask' by its name alone
 * (p4_brain_mask_prob.nii, a template tissue probability map) whose data are
 * known to be continuous (`isBinaryLike === false`) is an intensity image.
 */
export function layerRenderMode(
  layer: Pick<Layer, 'type' | 'layerKind'>,
  atlas = false,
  isBinaryLike?: boolean,
): LayerBaseRenderMode {
  const declared = moduleRegistry.getLayerKind(layer.layerKind)?.baseRenderMode;
  if (declared) return declared;
  if (layer.type === 'mask') return isBinaryLike === false ? 'scalar' : 'mask';
  return layer.type === 'label' || atlas ? 'label' : 'scalar';
}

/** Refuse an unknown or disabled module kind before allocating resources. */
export function requireLayerKind(layer: Pick<Layer, 'layerKind'>) {
  const kind = moduleRegistry.getLayerKind(layer.layerKind);
  if (layer.layerKind && !kind) {
    throw new Error(`Layer kind "${layer.layerKind}" is unavailable`);
  }
  return kind;
}
