interface LayerLike {
  id: string;
}

export function findNewLayerId(
  beforeLayerIds: Iterable<string>,
  layers: readonly LayerLike[]
): string | null {
  const seen = new Set(beforeLayerIds);

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layerId = layers[index]?.id;
    if (layerId && !seen.has(layerId)) {
      return layerId;
    }
  }

  return null;
}
