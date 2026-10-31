/**
 * Zoom, pan and Fit of the orthogonal slice views (QA features 2026-10-31
 * §1). ⌥-scroll or a pinch zooms about the pointer; Space-drag or a
 * middle-button drag pans; Fit (view toolbar, context menu, F) refits the
 * view to the visible layers. Zoom and pan belong to each view of each
 * workspace and survive slice steps, layer changes and resizes
 * (stores/viewZoomStore.ts marks a view as framed by the user).
 */
import type { ViewPlane, ViewType } from '@/types/coordinates';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useViewZoomStore } from '@/stores/viewZoomStore';
import { visibleFrameBox } from '@/services/layerFrameBoxes';
import { fitPlaneToWorldBox } from '@/utils/worldFrame';
import { getApiService } from '@/services/apiService';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  resizeZoomedPlane,
  zoomPanPlane,
  type CanvasPoint,
  type ZoomPlacement,
} from '@/utils/viewZoomGeometry';
import { calculateImagePlacement } from '@/utils/canvasUtils';
import { mirrorsView, useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';

/** Deepest zoom-in and furthest zoom-out, relative to the fitted view. */
export const MAX_ZOOM_IN = 40;
export const MAX_ZOOM_OUT = 4;

/**
 * Mounted slice canvases per view type, for the callers that have no pointer
 * (F, the context menu, ⌘K Fit). GoldenLayout keeps hidden tabs mounted, so
 * several canvases share a view type: the one actually on screen (a
 * non-empty rectangle) is used. Pointer gestures pass their own canvas.
 */
const panes = new Map<ViewType, Set<() => HTMLCanvasElement | null>>();

/** SliceViewCanvas registers its canvas; returns the unregister. */
export function registerZoomPane(viewType: ViewType, canvas: () => HTMLCanvasElement | null): () => void {
  let set = panes.get(viewType);
  if (!set) panes.set(viewType, (set = new Set()));
  set.add(canvas);
  return () => {
    panes.get(viewType)?.delete(canvas);
  };
}

function hasArea(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && canvas.width > 0 && canvas.height > 0;
}

/** The on-screen canvas of a view type, if one is mounted. */
function visibleCanvas(viewType: ViewType): HTMLCanvasElement | null {
  for (const get of panes.get(viewType) ?? []) {
    const canvas = get();
    if (canvas && hasArea(canvas)) return canvas;
  }
  return null;
}

function canvasSize(canvas: HTMLCanvasElement): [number, number] {
  return [canvas.width, canvas.height];
}

/**
 * The placement `plane` is drawn with on `canvas` (letterboxed, mirrored
 * under the radiological convention), derived from the plane itself rather
 * than from the last bitmap drawn, so consecutive gesture steps compose
 * before the backend has answered the previous one.
 */
export function placementForPlane(
  viewType: ViewType,
  plane: ViewPlane,
  canvas: [number, number],
): ZoomPlacement {
  const placement = calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], canvas[0], canvas[1]);
  return mirrorsView(viewType, useViewDisplaySettingsStore.getState().radiological)
    ? { ...placement, mirrorX: true }
    : placement;
}

/** A client point in canvas pixels (the canvas may be CSS-scaled). */
export function clientToCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): CanvasPoint | null {
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    canvasX: (clientX - rect.left) * (canvas.width / rect.width),
    canvasY: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

/** mm-per-pixel limits from the fitted view of the visible layers. */
function zoomLimits(
  viewType: ViewType,
  size: [number, number],
): { min: number; max: number } | undefined {
  const state = useViewStateStore.getState().viewState;
  const box = visibleFrameBox(state.layers);
  if (!box) return undefined;
  const fitted = fitPlaneToWorldBox(
    viewType,
    box,
    state.crosshair.world_mm,
    size,
    state.views[viewType],
  );
  const fitPixel = Math.hypot(...fitted.u_mm);
  return { min: fitPixel / MAX_ZOOM_IN, max: fitPixel * MAX_ZOOM_OUT };
}

function applyPlane(viewType: ViewType, next: ViewPlane | null): boolean {
  if (!next) return false;
  const store = useViewStateStore.getState();
  const workspaceKey = store.activeWorkspaceKey;
  store.setViewState((draft) => {
    draft.views[viewType] = next;
  });
  useViewZoomStore.getState().markZoomed(workspaceKey, viewType);
  return true;
}

/**
 * Zoom a view by `factor` (> 1 in) keeping the world point under the client
 * point where it is; without a point, about the canvas centre. `canvas` is
 * the pane the gesture happened on (else the on-screen pane of that type).
 */
export function zoomView(
  viewType: ViewType,
  factor: number,
  client?: { x: number; y: number },
  canvas: HTMLCanvasElement | null = visibleCanvas(viewType),
): boolean {
  if (!canvas || !hasArea(canvas)) return false;
  const size = canvasSize(canvas);
  const anchor = client
    ? clientToCanvas(canvas, client.x, client.y)
    : { canvasX: size[0] / 2, canvasY: size[1] / 2 };
  if (!anchor) return false;
  const plane = useViewStateStore.getState().viewState.views[viewType];
  return applyPlane(
    viewType,
    zoomPanPlane({
      plane,
      placement: placementForPlane(viewType, plane, size),
      canvas: size,
      anchor,
      factor,
      limits: zoomLimits(viewType, size),
    }),
  );
}

/** Pan a view by a drag of (dx, dy) client pixels on `canvas`. */
export function panView(
  viewType: ViewType,
  dxClient: number,
  dyClient: number,
  canvas: HTMLCanvasElement | null = visibleCanvas(viewType),
): boolean {
  if (!canvas || !hasArea(canvas)) return false;
  const rect = canvas.getBoundingClientRect();
  const size = canvasSize(canvas);
  const pan = { dx: dxClient * (size[0] / rect.width), dy: dyClient * (size[1] / rect.height) };
  const plane = useViewStateStore.getState().viewState.views[viewType];
  return applyPlane(
    viewType,
    zoomPanPlane({
      plane,
      placement: placementForPlane(viewType, plane, size),
      canvas: size,
      anchor: { canvasX: size[0] / 2, canvasY: size[1] / 2 },
      pan,
    }),
  );
}

/**
 * Keep a zoomed view covering its canvas after the canvas was resized (same
 * pixel size and centre). No-op for a fitted view.
 */
export function syncZoomedViewSize(viewType: ViewType, size: [number, number]): void {
  const store = useViewStateStore.getState();
  if (!useViewZoomStore.getState().zoomed[store.activeWorkspaceKey]?.[viewType]) return;
  const plane = store.viewState.views[viewType];
  if (plane.dim_px[0] === Math.round(size[0]) && plane.dim_px[1] === Math.round(size[1])) return;
  store.setViewState((draft) => {
    draft.views[viewType] = resizeZoomedPlane(draft.views[viewType], size);
  });
}

/**
 * Fit: drop the view's zoom and pan and frame the visible layers again, as
 * at load. Without boxes for every visible layer the backend frames the
 * first visible volume (the resize path's fallback).
 */
export async function fitView(viewType: ViewType): Promise<void> {
  const store = useViewStateStore.getState();
  const workspaceKey = store.activeWorkspaceKey;
  useViewZoomStore.getState().clearZoomed(workspaceKey, [viewType]);
  const canvas = visibleCanvas(viewType);
  const state = store.viewState;
  const size: [number, number] = canvas ? canvasSize(canvas) : [...state.views[viewType].dim_px];
  const box = visibleFrameBox(state.layers);
  if (box) {
    store.setViewState((draft) => {
      draft.views[viewType] = fitPlaneToWorldBox(
        viewType,
        box,
        draft.crosshair.world_mm,
        size,
        draft.views[viewType],
      );
    }, workspaceKey);
    return;
  }
  const layer = state.layers.find((l) => l.visible && l.opacity > 0 && l.volumeId);
  if (!layer) return;
  const plane = await getApiService().recalculateViewForDimensions(
    layer.volumeId,
    viewType,
    size,
    state.crosshair.world_mm as [number, number, number],
  );
  // Zoomed again while the backend answered: the user's frame wins.
  if (useViewZoomStore.getState().zoomed[workspaceKey]?.[viewType]) return;
  useViewStateStore.getState().setViewState((draft) => {
    draft.views[viewType] = plane;
  }, workspaceKey);
}

const SLICE_VIEW_TYPES: ReadonlySet<string> = new Set(['axial', 'sagittal', 'coronal']);

/** The view F and ⌘K "Fit View" fit: under the pointer, else the active one, else axial. */
export function fitTargetView(): ViewType {
  const hovered = useMouseCoordinateStore.getState().activeView;
  if (hovered) return hovered;
  const active = useActiveRenderContextStore.getState().activeId;
  return active && SLICE_VIEW_TYPES.has(active) ? (active as ViewType) : 'axial';
}

export function fitActiveView(): Promise<void> {
  return fitView(fitTargetView());
}

/** Whether the view of the active workspace is zoomed or panned. */
export function useIsViewZoomed(viewType: ViewType): boolean {
  const workspaceKey = useViewStateStore((state) => state.activeWorkspaceKey);
  return useViewZoomStore((state) => state.zoomed[workspaceKey]?.[viewType] === true);
}
