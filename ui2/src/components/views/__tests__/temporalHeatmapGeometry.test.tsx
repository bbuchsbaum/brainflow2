/**
 * The temporal heatmap lands on the image it describes: a voxel's heatmap
 * pixel and the image's projection of that voxel are the same canvas point,
 * letterboxed, mirrored (radiological) and zoomed; an oblique slice is not
 * drawn (QA 2026-10-31).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { calculateImagePlacement, projectWorldToCanvas } from '@brainflow/visualization/slice';
import { fitPlaneToWorldBox, edgeBoxFromAffine } from '@/utils/worldFrame';
import { zoomPanPlane } from '@/utils/viewZoomGeometry';
import {
  applyCanvasTransform,
  heatmapCanvasTransform,
  heatmapPixelIndex,
  type HeatmapAxis,
} from '../temporalHeatmapGeometry';
import type { ViewPlane } from '@/types/coordinates';

vi.mock('@/services/TemporalHeatmapService', () => ({
  getTemporalHeatmapService: () => ({
    getMetricMap: vi.fn().mockResolvedValue({ width: 2, height: 2, data: [0, 1, 2, 3] }),
  }),
}));

// 40 × 48 × 30 voxels of 2 mm, origin at the corner (−40, −50, −20).
const dims = [40, 48, 30];
const affine = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -40, -50, -20, 1];
const box = edgeBoxFromAffine(affine, dims)!;
const voxelWorld = (i: number, j: number, k: number): [number, number, number] => [
  -40 + 2 * i,
  -50 + 2 * j,
  -20 + 2 * k,
];
// Canvas wider than the image: letterboxed left and right.
const CANVAS: [number, number] = [500, 300];

function planeFor(axis: HeatmapAxis, at: [number, number, number]): ViewPlane {
  return fitPlaneToWorldBox(axis, box, at, CANVAS);
}

/** The heatmap pixel centre of voxel (a, b) and the image's projection of it agree. */
function expectAligned(axis: HeatmapAxis, plane: ViewPlane, placement: Parameters<typeof heatmapCanvasTransform>[4]) {
  const voxel: [number, number, number] = [7, 11, 5];
  const order = { axial: [0, 1, 2], coronal: [0, 2, 1], sagittal: [1, 2, 0] }[axis];
  const sliceIndex = voxel[order[2]];
  const t = heatmapCanvasTransform(axis, sliceIndex, affine, plane, placement)!;
  expect(t).not.toBeNull();
  const heat = applyCanvasTransform(t, voxel[order[0]] + 0.5, voxel[order[1]] + 0.5);
  const image = projectWorldToCanvas(voxelWorld(...voxel), plane, placement!, 1e6)!;
  expect(heat[0]).toBeCloseTo(image.canvasX, 6);
  expect(heat[1]).toBeCloseTo(image.canvasY, 6);
  return { t, heat, image };
}

describe('temporal heatmap placement', () => {
  it.each(['axial', 'coronal', 'sagittal'] as const)('letterboxed %s: a voxel lands on the image pixel', (axis) => {
    const plane = planeFor(axis, voxelWorld(7, 11, 5));
    const placement = calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], CANVAS[0], CANVAS[1]);
    expect(placement.x > 0 || placement.y > 0).toBe(true);
    expectAligned(axis, plane, placement);
  });

  it('mirrored (radiological): it follows the image, flipped', () => {
    const plane = planeFor('axial', voxelWorld(7, 11, 5));
    const base = calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], CANVAS[0], CANVAS[1]);
    const { t } = expectAligned('axial', plane, { ...base, mirrorX: true });
    // Voxel columns run right to left.
    expect(t[0]).toBeLessThan(0);
  });

  it('zoomed: it follows the zoomed plane', () => {
    const fitted = planeFor('axial', voxelWorld(7, 11, 5));
    const base = calculateImagePlacement(fitted.dim_px[0], fitted.dim_px[1], CANVAS[0], CANVAS[1]);
    const zoomed = zoomPanPlane({
      plane: fitted,
      placement: base,
      canvas: CANVAS,
      anchor: { canvasX: 180, canvasY: 120 },
      factor: 3,
      pan: { dx: 15, dy: -5 },
    })!;
    const full = { x: 0, y: 0, width: CANVAS[0], height: CANVAS[1], imageWidth: CANVAS[0], imageHeight: CANVAS[1] };
    expectAligned('axial', zoomed, full);
  });

  it('an oblique affine or an oblique view is not drawn', () => {
    const plane = planeFor('axial', voxelWorld(7, 11, 5));
    const placement = calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], CANVAS[0], CANVAS[1]);
    // Voxel j tilted 30° out of the axial plane.
    const c = Math.cos(Math.PI / 6) * 2;
    const s = Math.sin(Math.PI / 6) * 2;
    const oblique = [2, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, -40, -50, -20, 1];
    expect(heatmapCanvasTransform('axial', 5, oblique, plane, placement)).toBeNull();
    const tiltedView: ViewPlane = { ...plane, v_mm: [0, -c / 2, -s / 2] };
    expect(heatmapCanvasTransform('axial', 5, affine, tiltedView, placement)).toBeNull();
    // An in-plane rotation is exact, so it is drawn.
    const rotated = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 2, 0, -40, -50, -20, 1];
    expect(heatmapCanvasTransform('axial', 5, rotated, plane, placement)).not.toBeNull();
  });

  it('reads the backend slice first-axis-major (value (a, b) at a * height + b)', () => {
    // width 3 (a), height 2 (b): data index 1 is (a 0, b 1) -> row 1, column 0.
    expect(heatmapPixelIndex(1, 2, 3)).toBe(3);
    expect(heatmapPixelIndex(2, 2, 3)).toBe(1);
    expect(heatmapPixelIndex(5, 2, 3)).toBe(5);
  });

  it('the overlay hides itself with a note on an oblique slice', async () => {
    const { TemporalHeatmapOverlay } = await import('../TemporalHeatmapOverlay');
    const plane = planeFor('axial', voxelWorld(7, 11, 5));
    const placement = calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], CANVAS[0], CANVAS[1]);
    const c = Math.cos(Math.PI / 6) * 2;
    const s = Math.sin(Math.PI / 6) * 2;
    const props = { volumeId: 'v', metric: 'variance' as const, axis: 'axial' as const, sliceIndex: 5, width: 500, height: 300, viewPlane: plane, placement };
    const { rerender } = render(<TemporalHeatmapOverlay {...props} voxelToWorld={affine} />);
    expect(screen.queryByTestId('temporal-heatmap-note')).toBeNull();
    expect(screen.getByTestId('temporal-heatmap').hidden).toBe(false);
    rerender(<TemporalHeatmapOverlay {...props} voxelToWorld={[2, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, -40, -50, -20, 1]} />);
    expect(screen.getByTestId('temporal-heatmap-note').textContent).toBe('Heatmap needs an axis-aligned view');
    expect(screen.getByTestId('temporal-heatmap').hidden).toBe(true);
  });
});
