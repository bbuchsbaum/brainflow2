import type { ViewPlane, ViewType } from '@/types/coordinates';
import { refitToPx, toGpuFrameParams } from '@/utils/sliceGeometry';

export interface RequestedViewPayload {
  type: ViewType;
  origin_mm: [number, number, number, number];
  u_mm: [number, number, number, number];
  v_mm: [number, number, number, number];
  width: number;
  height: number;
}

/**
 * Resize a view plane to a new pixel dimension while preserving the world-space
 * field of view. Thin wrapper over the canonical `refitToPx`
 * (`@/utils/sliceGeometry`), which mirrors Rust `SliceGeometry::refit_to_px`.
 */
export function resizeViewPlanePreservingFieldOfView(
  view: ViewPlane,
  width: number,
  height: number,
): ViewPlane {
  return refitToPx(view, width, height);
}

/**
 * Build the requested-view payload the backend consumes: the field-of-view is
 * preserved via {@link resizeViewPlanePreservingFieldOfView}, then converted to
 * GPU frame parameters (origin w=1, full-frame u/v spans) via the shared
 * `toGpuFrameParams`.
 */
export function buildRequestedViewPayload(
  viewType: ViewType,
  view: ViewPlane,
  width: number,
  height: number,
): RequestedViewPayload {
  const resizedView = refitToPx(view, width, height);
  const frame = toGpuFrameParams(resizedView);

  return {
    type: viewType,
    origin_mm: frame.origin,
    u_mm: frame.u,
    v_mm: frame.v,
    width,
    height,
  };
}
