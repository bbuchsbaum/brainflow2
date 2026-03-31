import type { ViewPlane, ViewType } from '@/types/coordinates';

export interface RequestedViewPayload {
  type: ViewType;
  origin_mm: [number, number, number, number];
  u_mm: [number, number, number, number];
  v_mm: [number, number, number, number];
  width: number;
  height: number;
}

function vectorMagnitude(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function scaleVector(
  vector: [number, number, number],
  scale: number
): [number, number, number] {
  return [
    vector[0] * scale,
    vector[1] * scale,
    vector[2] * scale,
  ];
}

function addVectors(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
  ];
}

function subtractVectors(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

export function resizeViewPlanePreservingFieldOfView(
  view: ViewPlane,
  width: number,
  height: number
): ViewPlane {
  const baseWidth = view.dim_px?.[0] > 0 ? view.dim_px[0] : width;
  const baseHeight = view.dim_px?.[1] > 0 ? view.dim_px[1] : height;
  const uMagnitude = vectorMagnitude(view.u_mm);
  const vMagnitude = vectorMagnitude(view.v_mm);

  if (uMagnitude === 0 || vMagnitude === 0) {
    return {
      ...view,
      dim_px: [width, height],
    };
  }

  const totalUMm = uMagnitude * baseWidth;
  const totalVMm = vMagnitude * baseHeight;
  const pixelSize = Math.max(totalUMm / Math.max(width, 1), totalVMm / Math.max(height, 1));

  const uDirection = scaleVector(view.u_mm, 1 / uMagnitude);
  const vDirection = scaleVector(view.v_mm, 1 / vMagnitude);
  const resizedU = scaleVector(uDirection, pixelSize);
  const resizedV = scaleVector(vDirection, pixelSize);
  const originalCenter = addVectors(
    view.origin_mm,
    addVectors(scaleVector(view.u_mm, baseWidth / 2), scaleVector(view.v_mm, baseHeight / 2))
  );
  const resizedOrigin = subtractVectors(
    originalCenter,
    addVectors(scaleVector(resizedU, width / 2), scaleVector(resizedV, height / 2))
  );

  return {
    ...view,
    origin_mm: resizedOrigin,
    u_mm: resizedU,
    v_mm: resizedV,
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
