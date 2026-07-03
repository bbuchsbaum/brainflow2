/**
 * Cross-language parity: the TypeScript slice-frame geometry
 * (`@/utils/sliceGeometry`) must reproduce the canonical Rust contract.
 *
 * Fixtures are produced by `core/neuro-types/tests/slice_geometry_parity.rs`
 * (regenerate with
 * `UPDATE_SLICE_GEOMETRY_FIXTURES=1 cargo test -p neuro-types --test slice_geometry_parity`).
 * Each fixture case carries a full-extent `view_plane` plus the Rust outputs of
 * `pixel_to_world`, `to_gpu_frame_params`, and `refit_to_px`; this test asserts
 * the TS port matches within 1e-4.
 */

import { describe, expect, it } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import { pixelToWorld, refitToPx, toGpuFrameParams } from '@/utils/sliceGeometry';
import fixtureData from './fixtures/sliceGeometryParity.json';

interface FixtureCase {
  name: string;
  orientation: string;
  view_plane: ViewPlane;
  pixel_to_world: Array<{ x: number; y: number; world: [number, number, number] }>;
  gpu_frame_params: {
    origin: [number, number, number, number];
    u: [number, number, number, number];
    v: [number, number, number, number];
  };
  refit: { dim_px: [number, number]; view_plane: ViewPlane };
}

const fixtures = fixtureData as unknown as FixtureCase[];

const TOL = 1e-4;

function expectClose(actual: number[], expected: number[], label: string): void {
  expect(actual.length, `${label}: length`).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(
      Math.abs(actual[i] - expected[i]),
      `${label}[${i}] (${actual[i]} vs ${expected[i]})`,
    ).toBeLessThanOrEqual(TOL);
  }
}

describe('sliceGeometry parity with Rust SliceGeometry', () => {
  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it('pixelToWorld matches Rust pixel_to_world', () => {
        for (const sample of fixture.pixel_to_world) {
          const world = pixelToWorld(fixture.view_plane, sample.x, sample.y);
          expectClose(world, sample.world, `pixelToWorld(${sample.x},${sample.y})`);
        }
      });

      it('toGpuFrameParams matches Rust to_gpu_frame_params', () => {
        const frame = toGpuFrameParams(fixture.view_plane);
        expectClose(frame.origin, fixture.gpu_frame_params.origin, 'gpu.origin');
        expectClose(frame.u, fixture.gpu_frame_params.u, 'gpu.u');
        expectClose(frame.v, fixture.gpu_frame_params.v, 'gpu.v');
      });

      it('refitToPx matches Rust refit_to_px', () => {
        const [w, h] = fixture.refit.dim_px;
        const refit = refitToPx(fixture.view_plane, w, h);
        expect(refit.dim_px).toEqual(fixture.refit.dim_px);
        expectClose(refit.origin_mm, fixture.refit.view_plane.origin_mm, 'refit.origin_mm');
        expectClose(refit.u_mm, fixture.refit.view_plane.u_mm, 'refit.u_mm');
        expectClose(refit.v_mm, fixture.refit.view_plane.v_mm, 'refit.v_mm');
      });
    });
  }
});
