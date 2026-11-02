/** Shared interpretation of module layer declarations for core services. */
import type { Layer } from '@/types/layers';
import type { LayerBaseRenderMode } from './api';
import { moduleRegistry } from './registry';

export function layerRenderMode(layer: Pick<Layer, 'type' | 'layerKind'>, atlas = false): LayerBaseRenderMode {
  return moduleRegistry.getLayerKind(layer.layerKind)?.baseRenderMode ??
    (layer.type === 'mask' ? 'mask' : layer.type === 'label' || atlas ? 'label' : 'scalar');
}

/** Refuse an unknown or disabled module kind before allocating resources. */
export function requireLayerKind(layer: Pick<Layer, 'layerKind'>) {
  const kind = moduleRegistry.getLayerKind(layer.layerKind);
  if (layer.layerKind && !kind) {
    throw new Error(`Layer kind "${layer.layerKind}" is unavailable`);
  }
  return kind;
}
