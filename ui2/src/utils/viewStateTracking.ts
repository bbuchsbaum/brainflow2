import type { Patch } from 'immer';
import type { ViewPlane, ViewType, WorldCoordinates } from '@/types/coordinates';
import type {
  CrosshairState,
  ViewLayer,
  ViewState,
  ViewStateRevisions
} from '@/types/viewState';

export const TRACKED_VIEW_TYPES: ViewType[] = ['axial', 'sagittal', 'coronal'];

export function createInitialViewStateRevisions(): ViewStateRevisions {
  return {
    state: 0,
    layers: 0,
    crosshair: 0,
    timepoint: 0,
    views: {
      axial: 0,
      sagittal: 0,
      coronal: 0
    }
  };
}

export function cloneViewStateRevisions(revisions: ViewStateRevisions): ViewStateRevisions {
  return {
    state: revisions.state,
    layers: revisions.layers,
    crosshair: revisions.crosshair,
    timepoint: revisions.timepoint,
    views: {
      axial: revisions.views.axial,
      sagittal: revisions.views.sagittal,
      coronal: revisions.views.coronal
    }
  };
}

export function applyViewStateRevisionPatches(
  revisions: ViewStateRevisions,
  patches: Patch[]
): ViewStateRevisions {
  if (patches.length === 0) {
    return revisions;
  }

  const next = cloneViewStateRevisions(revisions);
  next.state += 1;

  let layersChanged = false;
  let crosshairChanged = false;
  let timepointChanged = false;
  const changedViews = new Set<ViewType>();

  for (const patch of patches) {
    const [root, branch] = patch.path;

    switch (root) {
      case 'layers':
        layersChanged = true;
        break;
      case 'crosshair':
        crosshairChanged = true;
        break;
      case 'timepoint':
        timepointChanged = true;
        break;
      case 'views':
        if (branch === undefined) {
          TRACKED_VIEW_TYPES.forEach((viewType) => changedViews.add(viewType));
        } else if (isViewType(branch)) {
          changedViews.add(branch);
        }
        break;
      default:
        break;
    }
  }

  if (layersChanged) {
    next.layers += 1;
  }
  if (crosshairChanged) {
    next.crosshair += 1;
  }
  if (timepointChanged) {
    next.timepoint += 1;
  }
  changedViews.forEach((viewType) => {
    next.views[viewType] += 1;
  });

  return next;
}

export function areWorldCoordinatesEqual(
  left: WorldCoordinates,
  right: WorldCoordinates
): boolean {
  return (
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  );
}

export function areDimensionsEqual(
  left: [number, number],
  right: [number, number]
): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function areViewPlaneGeometryEqual(left: ViewPlane, right: ViewPlane): boolean {
  return (
    areWorldCoordinatesEqual(left.origin_mm, right.origin_mm) &&
    areWorldCoordinatesEqual(left.u_mm, right.u_mm) &&
    areWorldCoordinatesEqual(left.v_mm, right.v_mm)
  );
}

export function areViewPlanesEqual(left: ViewPlane, right: ViewPlane): boolean {
  return areViewPlaneGeometryEqual(left, right) && areDimensionsEqual(left.dim_px, right.dim_px);
}

export function areCrosshairStatesEqual(left: CrosshairState, right: CrosshairState): boolean {
  return left.visible === right.visible && areWorldCoordinatesEqual(left.world_mm, right.world_mm);
}

export function areViewLayersEqual(
  left: Partial<ViewLayer>,
  right: Partial<ViewLayer>
): boolean {
  const leftIntensity = normalizePair(
    left.intensity,
    (left as unknown as { render?: { intensityMin?: number; intensityMax?: number } }).render?.intensityMin,
    (left as unknown as { render?: { intensityMin?: number; intensityMax?: number } }).render?.intensityMax
  );
  const rightIntensity = normalizePair(
    right.intensity,
    (right as unknown as { render?: { intensityMin?: number; intensityMax?: number } }).render?.intensityMin,
    (right as unknown as { render?: { intensityMin?: number; intensityMax?: number } }).render?.intensityMax
  );
  const leftThreshold = normalizePair(
    left.threshold,
    (left as unknown as { render?: { thresholdLow?: number; thresholdHigh?: number } }).render?.thresholdLow,
    (left as unknown as { render?: { thresholdLow?: number; thresholdHigh?: number } }).render?.thresholdHigh
  );
  const rightThreshold = normalizePair(
    right.threshold,
    (right as unknown as { render?: { thresholdLow?: number; thresholdHigh?: number } }).render?.thresholdLow,
    (right as unknown as { render?: { thresholdLow?: number; thresholdHigh?: number } }).render?.thresholdHigh
  );
  const leftOpacity = left.opacity ?? (left as unknown as { render?: { opacity?: number } }).render?.opacity;
  const rightOpacity = right.opacity ?? (right as unknown as { render?: { opacity?: number } }).render?.opacity;
  const leftColormap = left.colormap ?? (left as unknown as { render?: { colormap?: string } }).render?.colormap;
  const rightColormap = right.colormap ?? (right as unknown as { render?: { colormap?: string } }).render?.colormap;

  return (
    left.id === right.id &&
    left.name === right.name &&
    left.volumeId === right.volumeId &&
    left.visible === right.visible &&
    leftOpacity === rightOpacity &&
    leftColormap === rightColormap &&
    left.blendMode === right.blendMode &&
    left.interpolation === right.interpolation &&
    leftIntensity[0] === rightIntensity[0] &&
    leftIntensity[1] === rightIntensity[1] &&
    leftThreshold[0] === rightThreshold[0] &&
    leftThreshold[1] === rightThreshold[1]
  );
}

export function areViewLayerListsEqual(
  left: Array<Partial<ViewLayer>>,
  right: Array<Partial<ViewLayer>>
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((layer, index) => areViewLayersEqual(layer, right[index]));
}

export function areViewStatesEqual(left: ViewState, right: ViewState): boolean {
  if (!areViewLayerListsEqual(left.layers, right.layers)) {
    return false;
  }
  if (!areCrosshairStatesEqual(left.crosshair, right.crosshair)) {
    return false;
  }
  if (left.timepoint !== right.timepoint) {
    return false;
  }

  return TRACKED_VIEW_TYPES.every((viewType) => areViewPlanesEqual(left.views[viewType], right.views[viewType]));
}

function isViewType(value: unknown): value is ViewType {
  return value === 'axial' || value === 'sagittal' || value === 'coronal';
}

function normalizePair(
  pair: [number, number] | undefined,
  fallbackFirst: number | undefined,
  fallbackSecond: number | undefined
): [number | undefined, number | undefined] {
  if (pair) {
    return pair;
  }

  return [fallbackFirst, fallbackSecond];
}
