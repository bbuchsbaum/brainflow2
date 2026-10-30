/**
 * The layer the status bar reports and the voxel grid its ijk is on (QA
 * design decisions 2026-10-30, section 3). Shared by the status bar, the
 * Inspector's readout caption and the Go-to dialog so every ijk display
 * defaults to the same (selected) layer and names that grid.
 */
import { useMemo } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useStatusReadoutStore } from '@/stores/statusReadoutStore';
import { resolveStatusLayer, useActiveLayerSelection } from '@/utils/activeLayer';
import { resolveReadoutGrid, type ReadoutGrid } from '@/utils/voxelSnap';
import { shortLayerLabel } from '@/components/views/viewportFrame/frameFormat';

const NO_LAYERS: never[] = [];

/** The status bar's layer (see `resolveStatusLayer`). */
export function useStatusLayer(): { id: string; name: string } | null {
  const viewLayers = useViewStateStore((state) => state.viewState?.layers) ?? NO_LAYERS;
  const selection = useActiveLayerSelection();
  const override = useStatusReadoutStore((state) => state.override);
  return useMemo(
    () => resolveStatusLayer(viewLayers, selection, override),
    [viewLayers, selection, override],
  );
}

export interface NamedReadoutGrid extends ReadoutGrid {
  /** Short grid name for "ijk 23, 41, 30 (zstat1)". */
  label: string;
}

/** The status layer's voxel grid (else the reference grid), named. */
export function useReadoutGrid(): NamedReadoutGrid | null {
  const layer = useStatusLayer();
  const layers = useLayerStore((state) => state.layers);
  const layerMetadata = useLayerStore((state) => state.layerMetadata);
  const layerId = layer?.id ?? null;
  return useMemo(() => {
    const grid = resolveReadoutGrid(layerId, layers ?? NO_LAYERS, layerMetadata);
    return grid ? { ...grid, label: shortLayerLabel(grid.name || grid.layerId) } : null;
  }, [layerId, layers, layerMetadata]);
}

/**
 * The name in "ijk … (name)": always the reported layer, so the status bar
 * names it even when that layer has no affine. On the layer's own grid:
 * "zstat1"; on the reference grid instead: "zstat1, reference grid"; no grid
 * at all: "zstat1" (with "ijk —").
 */
export function ijkSuffix(
  layer: { id: string; name: string } | null,
  grid: Pick<NamedReadoutGrid, 'layerId' | 'label'> | null,
): string | null {
  if (!layer) return grid ? grid.label : null;
  const name = shortLayerLabel(layer.name || layer.id);
  if (!grid || grid.layerId === layer.id) return name;
  return `${name}, reference grid`;
}

/**
 * `ijkSuffix` for the live status layer, named as the layer store names it
 * (the file name, as the cluster table and Go-to dialog show it).
 */
export function useIjkSuffix(grid: NamedReadoutGrid | null): string | null {
  const layer = useStatusLayer();
  const storeName = useLayerStore((state) =>
    layer ? state.layers?.find((l) => l.id === layer.id)?.name : undefined,
  );
  return ijkSuffix(layer ? { id: layer.id, name: storeName || layer.name } : null, grid);
}
