/**
 * Layers whose display was restored from saved settings (undo of a removal,
 * SceneHistoryService): the background histogram refinement in LayerApiImpl
 * must not replace it.
 */
const restored = new Set<string>();

/** Keep a reopened layer's restored display: no histogram refinement. */
export function preserveLayerDisplay(layerId: string): void {
  restored.add(layerId);
}

export function isLayerDisplayPreserved(layerId: string): boolean {
  return restored.has(layerId);
}

export function forgetPreservedDisplay(layerId: string): void {
  restored.delete(layerId);
}
