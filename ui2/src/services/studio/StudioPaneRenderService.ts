/**
 * StudioPaneRenderService - draws one Set studio Compare pane (cohort mean,
 * residual, z-score) on its own.
 *
 * The orthogonal views draw the workspace ViewState, narrowed by the member
 * render scope to the current member (pane A). A derived pane instead renders
 * a ViewState holding only its own map (a StudioDerivedMap, never a workspace
 * layer) over the template anatomy when the set's space has one, framed on that map's grid at the Studio workspace's crosshair, and
 * stores the bitmap under its own tag (the Mosaic/Compare pattern), so the
 * four panes show four maps at once (QA F8).
 */

import { getApiService } from '@/services/apiService';
import { getViewPlaneService } from '@/services/ViewPlaneService';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';
import type { ViewLayer, ViewState } from '@/types/viewState';
import type { StudioDerivedMap } from './StudioDerivedMapService';

export type StudioPanePlane = 'axial' | 'coronal' | 'sagittal';

export function studioPaneTag(paneId: string, plane: StudioPanePlane): string {
  return `studio-pane-${paneId}-${plane}`;
}

const SLICE_AXIS: Record<StudioPanePlane, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 };

/** Share of a derived map's window hidden around zero (as in Population). */
export const STUDIO_DERIVED_HIDDEN_FRACTION = 0.1;

/**
 * How a derived map is drawn. Signed maps (residual and z-score always, any
 * map with negative values) use the diverging blue–white–red map with a
 * symmetric window, values within a tenth of the window of zero hidden. A
 * nonnegative map (a cohort mean of GM density, FA or CBF) uses the
 * sequential Hot map over its own range, its lowest tenth hidden, so the
 * anatomy shows through and no half of a diverging map is wasted (review L2).
 */
export function studioDerivedDisplay(
  map: StudioDerivedMap,
  name: string,
  signed = false,
): ViewLayer {
  const min = map.dataRange?.min ?? -1;
  const max = map.dataRange?.max ?? 1;
  const base = {
    id: map.layerId,
    name,
    volumeId: map.volumeId,
    visible: true,
    opacity: 1,
    blendMode: 'alpha' as const,
    interpolation: 'linear' as const,
    layerMode: 'scalar' as const,
  };
  if (signed || min < 0) {
    const limit = Math.max(Math.abs(min), Math.abs(max)) || 1;
    const band = STUDIO_DERIVED_HIDDEN_FRACTION * limit;
    return { ...base, colormap: 'fmri', intensity: [-limit, limit], threshold: [-band, band] };
  }
  const top = max > min ? max : min + 1;
  const band = STUDIO_DERIVED_HIDDEN_FRACTION * (top - min);
  return { ...base, colormap: 'hot', intensity: [min, top], threshold: [min, min + band] };
}

/** Compare panes whose maps are signed by construction. */
export const STUDIO_SIGNED_PANES: ReadonlySet<string> = new Set(['residual', 'zscore']);

/** The template anatomy under a derived map: grey over its own range. */
export function studioAnatomyDisplay(map: StudioDerivedMap): ViewLayer {
  const min = map.dataRange?.min ?? 0;
  const max = map.dataRange?.max ?? 1;
  return {
    id: map.layerId,
    name: 'Anatomy',
    volumeId: map.volumeId,
    visible: true,
    opacity: 1,
    colormap: 'gray',
    intensity: [min, max > min ? max : min + 1],
    threshold: [min, min],
    blendMode: 'alpha',
    interpolation: 'linear',
    layerMode: 'scalar',
  };
}

/** The ViewState a pane draws: only `layers` (anatomy first), with the pane's plane and crosshair. */
export function buildStudioPaneViewState(
  workspace: ViewState,
  layers: ViewLayer[],
  plane: StudioPanePlane,
  viewPlane: ViewPlane,
  crosshair: WorldCoordinates,
): ViewState {
  return {
    ...workspace,
    crosshair: { ...workspace.crosshair, world_mm: crosshair },
    views: { ...workspace.views, [plane]: viewPlane },
    layers,
  };
}

const latest = new Map<string, number>();
let nextRequest = 1;

/**
 * Render a pane; resolves to the plane it drew (for click mapping and the
 * crosshair), or null when a newer render of the tag took over.
 */
export async function renderStudioPane(request: {
  tag: string;
  workspaceId: string;
  map: StudioDerivedMap;
  /** Drawn bottom to top: the anatomy (if any), then the map. */
  layers: ViewLayer[];
  plane: StudioPanePlane;
  width: number;
  height: number;
}): Promise<ViewPlane | null> {
  const { tag, workspaceId, map, layers, plane, width, height } = request;
  if (width <= 0 || height <= 0) return null;
  const id = nextRequest++;
  latest.set(tag, id);
  const workspace = useViewStateStore.getState().getWorkspaceViewState(workspaceId);
  const { min, max } = map.bounds;

  // The crosshair inside the map's grid, else the grid centre.
  const world = workspace.crosshair.world_mm;
  const inside = world.every((v, i) => v >= min[i] && v <= max[i]);
  const crosshair: WorldCoordinates = inside
    ? [world[0], world[1], world[2]]
    : ([0, 1, 2].map((i) => (min[i] + max[i]) / 2) as WorldCoordinates);
  const viewPlane = getViewPlaneService().createSliceViewPlane(
    plane,
    crosshair[SLICE_AXIS[plane]],
    { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] },
    [Math.floor(width), Math.floor(height)],
  );
  const state = buildStudioPaneViewState(workspace, layers, plane, viewPlane, crosshair);

  useRenderStateStore.getState().setRendering(tag, true);
  try {
    const image = await getApiService().applyAndRenderViewState(
      state,
      plane,
      viewPlane.dim_px[0],
      viewPlane.dim_px[1],
    );
    if (latest.get(tag) !== id) return null;
    if (!image) throw new Error('No image returned for the Studio pane');
    useRenderStateStore.getState().setImage(tag, image);
    return viewPlane;
  } catch (error) {
    if (latest.get(tag) === id) {
      useRenderStateStore
        .getState()
        .setError(tag, error instanceof Error ? error : new Error(String(error)));
    }
    return null;
  } finally {
    if (latest.get(tag) === id) {
      useRenderStateStore.getState().setRendering(tag, false);
      latest.delete(tag);
    }
  }
}

type PaneRequest = Parameters<typeof renderStudioPane>[0];
const scheduled = new Map<
  string,
  { request: PaneRequest; onDrawn: (plane: ViewPlane) => void; frame: number }
>();

const nextFrame: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16) as unknown as number;
const cancelFrame: (handle: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (handle) => cancelAnimationFrame(handle)
    : (handle) => clearTimeout(handle);

/**
 * Coalesced render: at most one render per pane tag per animation frame, of
 * the latest request (a member window drag must not queue a render_view per
 * update for every pane; review W2).
 */
export function scheduleStudioPaneRender(
  request: PaneRequest,
  onDrawn: (plane: ViewPlane) => void,
): void {
  const queued = scheduled.get(request.tag);
  if (queued) {
    queued.request = request;
    queued.onDrawn = onDrawn;
    return;
  }
  const entry = {
    request,
    onDrawn,
    frame: nextFrame(() => {
      scheduled.delete(request.tag);
      void renderStudioPane(entry.request).then((drawn) => {
        if (drawn) entry.onDrawn(drawn);
      });
    }),
  };
  scheduled.set(request.tag, entry);
}

/** A pane went away: drop its bitmap and any render queued or in flight (review L2). */
export function clearStudioPane(tag: string): void {
  const queued = scheduled.get(tag);
  if (queued) cancelFrame(queued.frame);
  scheduled.delete(tag);
  latest.delete(tag);
  useRenderStateStore.getState().clearState(tag);
}
