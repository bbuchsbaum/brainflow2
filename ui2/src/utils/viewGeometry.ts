import type { ViewPlane, ViewType } from '@/types/coordinates';

export interface RequestedViewPayload {
  type: ViewType;
  origin_mm: [number, number, number, number];
  u_mm: [number, number, number, number];
  v_mm: [number, number, number, number];
  width: number;
  height: number;
}

export function resizeViewPlanePreservingFieldOfView(
  view: ViewPlane,
  width: number,
  height: number
): ViewPlane {
  const baseWidth = view.dim_px?.[0] > 0 ? view.dim_px[0] : width;
  const baseHeight = view.dim_px?.[1] > 0 ? view.dim_px[1] : height;
  const totalU = view.u_mm.map((component) => component * baseWidth) as [number, number, number];
  const totalV = view.v_mm.map((component) => component * baseHeight) as [number, number, number];

  return {
    ...view,
    u_mm: totalU.map((component) => component / width) as [number, number, number],
    v_mm: totalV.map((component) => component / height) as [number, number, number],
    dim_px: [width, height],
  };
}

export function buildRequestedViewPayload(
  viewType: ViewType,
  view: ViewPlane,
  width: number,
  height: number
): RequestedViewPayload {
  const resizedView = resizeViewPlanePreservingFieldOfView(view, width, height);

  return {
    type: viewType,
    origin_mm: [...resizedView.origin_mm, 1.0],
    u_mm: [
      resizedView.u_mm[0] * width,
      resizedView.u_mm[1] * width,
      resizedView.u_mm[2] * width,
      0.0,
    ],
    v_mm: [
      resizedView.v_mm[0] * height,
      resizedView.v_mm[1] * height,
      resizedView.v_mm[2] * height,
      0.0,
    ],
    width,
    height,
  };
}
