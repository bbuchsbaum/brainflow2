import { describe, expect, it } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import { buildRequestedViewPayload, resizeViewPlanePreservingFieldOfView } from '@/utils/viewGeometry';

function createViewPlane(): ViewPlane {
  return {
    origin_mm: [0, 0, 0],
    u_mm: [0, 1, 0],
    v_mm: [0, 0, 1],
    dim_px: [256, 256],
  };
}

describe('viewGeometry', () => {
  it('resizes a view plane while preserving field of view', () => {
    const resized = resizeViewPlanePreservingFieldOfView(createViewPlane(), 128, 512);

    expect(resized.dim_px).toEqual([128, 512]);
    expect(resized.u_mm).toEqual([0, 2, 0]);
    expect(resized.v_mm).toEqual([0, 0, 0.5]);
  });

  it('builds requested-view payloads using preserved total vectors', () => {
    const payload = buildRequestedViewPayload('sagittal', createViewPlane(), 128, 512);

    expect(payload.type).toBe('sagittal');
    expect(payload.origin_mm).toEqual([0, 0, 0, 1]);
    expect(payload.u_mm).toEqual([0, 256, 0, 0]);
    expect(payload.v_mm).toEqual([0, 0, 256, 0]);
    expect(payload.width).toBe(128);
    expect(payload.height).toBe(512);
  });
});
