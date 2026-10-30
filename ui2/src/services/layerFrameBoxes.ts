/**
 * World boxes (outer voxel edges, world axes) of loaded volume layers, used to
 * frame the standard panes on the union of the visible layers.
 *
 * A box is recorded at load, exactly, from the volume's affine and dimensions
 * (`edgeBoxFromAffine`); the backend's initial views are only a fallback, since
 * they carry the square-pixel slack of the load-time raster. Layer ids are
 * volume ids, so one map serves all workspaces.
 */
import type { ViewPlane, ViewType } from '@/types/coordinates';
import type { ViewState } from '@/types/viewState';
import {
  clampToWorldBox,
  fitViewsToWorldBox,
  framesWithin,
  largestPixelMm,
  sameWorldBox,
  unionWorldBoxes,
  worldBoxFromViews,
  type WorldBox,
} from '@/utils/worldFrame';

const boxes = new Map<string, WorldBox>();

interface FramedLayer {
  id: string;
  visible?: boolean;
  opacity?: number;
}

export const layerFrameBoxes = {
  record(layerId: string, box: WorldBox): void {
    boxes.set(layerId, box);
  },
  /** Fallback: the box the initial views of the volume alone frame. */
  recordFromViews(layerId: string, views: Partial<Record<ViewType, ViewPlane>>): void {
    const box = worldBoxFromViews(views);
    if (box) boxes.set(layerId, box);
  },
  move(fromId: string, toId: string): void {
    const box = boxes.get(fromId);
    if (!box || fromId === toId) return;
    boxes.set(toId, box);
    boxes.delete(fromId);
  },
  get(layerId: string): WorldBox | undefined {
    return boxes.get(layerId);
  },
  delete(layerId: string): void {
    boxes.delete(layerId);
  },
  /** Drop the boxes of layers no workspace shows any more. */
  retainOnly(layerIds: Iterable<string>): void {
    const keep = new Set(layerIds);
    for (const id of Array.from(boxes.keys())) {
      if (!keep.has(id)) boxes.delete(id);
    }
  },
  clear(): void {
    boxes.clear();
  },
};

const isShown = (layer: FramedLayer) => layer.visible !== false && (layer.opacity ?? 1) > 0;

/**
 * Union of the visible layers' boxes. Null when no layer is visible or any
 * visible layer has no recorded box: callers then keep their single-volume
 * path rather than frame a partial union.
 */
export function visibleFrameBox(
  layers: ReadonlyArray<FramedLayer> | null | undefined,
): WorldBox | null {
  const visible = (layers ?? []).filter(isShown);
  if (visible.length === 0) return null;
  const known = visible.map((layer) => boxes.get(layer.id));
  if (known.some((box) => !box)) return null;
  return unionWorldBoxes(known);
}

const shownIds = (layers: ReadonlyArray<FramedLayer>) =>
  layers
    .filter(isShown)
    .map((layer) => layer.id)
    .join('\u0000');

/**
 * Refits the standard panes of `next` when an update changed which layers are
 * shown and that changed the union of their boxes. Runs on every view-state
 * update, so a layer added, removed or shown through any writer (the Layers
 * panel, the Inspector, the Series view) grows or shrinks the frame. An
 * unchanged union keeps the user's zoom and pan. When the change removed a
 * layer, the crosshair is kept inside the remaining frame.
 */
export function reframeForLayerChange(previous: ViewState, next: ViewState): void {
  if (!next.views || !next.crosshair || !previous.layers || !next.layers) return;
  if (shownIds(previous.layers) === shownIds(next.layers)) return;
  const after = visibleFrameBox(next.layers);
  if (!after) return;
  const before = visibleFrameBox(previous.layers);
  if (before) {
    if (sameWorldBox(before, after)) return;
  } else {
    // Nothing was framed by layers before (e.g. the first layer, whose initial
    // views were just written): keep panes that already frame the union.
    const shown = worldBoxFromViews(next.views);
    if (shown && framesWithin(shown, after, largestPixelMm(next.views) * 1.01)) return;
  }

  const removed = previous.layers.some((old) => !next.layers.some((layer) => layer.id === old.id));
  let crosshair = next.crosshair.world_mm;
  if (removed) {
    const clamped = clampToWorldBox(crosshair, after);
    if (clamped.some((value, axis) => value !== crosshair[axis])) {
      next.crosshair.world_mm = clamped;
      crosshair = clamped;
    }
  }
  next.views = fitViewsToWorldBox(next.views, after, crosshair);
}
