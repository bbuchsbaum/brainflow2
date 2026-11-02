/**
 * The temporal heatmap is computed on a view-plane grid and lands on the image
 * it describes: letterboxed, mirrored (radiological), zoomed and through a
 * plane that leaves the voxel axes. Its overlay keeps only the newest request,
 * leaves NaN transparent and shows its pending and failed states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { calculateImagePlacement, projectWorldToCanvas } from '@brainflow/visualization/slice';
import { fitPlaneToWorldBox, edgeBoxFromAffine } from '@/utils/worldFrame';
import { zoomPanPlane } from '@/utils/viewZoomGeometry';
import {
  applyCanvasTransform,
  heatmapCanvasTransform,
  heatmapColorScale,
  heatmapGrid,
  heatmapRgba,
  MAX_GRID_SIDE,
  voxelSizeMm,
  type HeatmapPlacement,
} from '../temporalHeatmapGeometry';
import { HEATMAP_REQUEST_DEBOUNCE_MS, TemporalHeatmapOverlay } from '../TemporalHeatmapOverlay';
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';
import type { TemporalMetricMap } from '@/services/TemporalHeatmapService';

const service = vi.hoisted(() => ({ peekPlaneMap: vi.fn(), getPlaneMap: vi.fn() }));
vi.mock('@/services/TemporalHeatmapService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/TemporalHeatmapService')>()),
  getTemporalHeatmapService: () => service,
}));

// 40 × 48 × 30 voxels of 2 mm, origin at the corner (−40, −50, −20).
const dims = [40, 48, 30];
const affine = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -40, -50, -20, 1];
const box = edgeBoxFromAffine(affine, dims)!;
const voxelWorld = (i: number, j: number, k: number): WorldCoordinates => [
  -40 + 2 * i,
  -50 + 2 * j,
  -20 + 2 * k,
];
// Canvas wider than the image: letterboxed left and right.
const CANVAS: [number, number] = [500, 300];
type Axis = 'axial' | 'coronal' | 'sagittal';
const planeFor = (axis: Axis, at: WorldCoordinates): ViewPlane =>
  fitPlaneToWorldBox(axis, box, at, CANVAS);
const placementFor = (plane: ViewPlane): HeatmapPlacement =>
  calculateImagePlacement(plane.dim_px[0], plane.dim_px[1], CANVAS[0], CANVAS[1]);

/** Any world point of the plane: its heatmap pixel and the image agree. */
function expectAligned(plane: ViewPlane, placement: HeatmapPlacement, at = [0.3, 0.6]) {
  const grid = heatmapGrid(plane, 2);
  const transform = heatmapCanvasTransform(grid, plane, placement)!;
  expect(transform).not.toBeNull();
  const s = at[0] * grid.width;
  const t = at[1] * grid.height;
  const world = [0, 1, 2].map(
    (a) => grid.origin_mm[a] + s * grid.u_mm[a] + t * grid.v_mm[a],
  ) as WorldCoordinates;
  const heat = applyCanvasTransform(transform, s, t);
  const image = projectWorldToCanvas(world, plane, placement, 1e6)!;
  expect(heat[0]).toBeCloseTo(image.canvasX, 6);
  expect(heat[1]).toBeCloseTo(image.canvasY, 6);
  return transform;
}

describe('temporal heatmap grid', () => {
  const plane: ViewPlane = {
    origin_mm: [0, 0, 0],
    u_mm: [0.5, 0, 0],
    v_mm: [0, 0.5, 0],
    dim_px: [401, 200],
  };

  it('downsamples to about voxel resolution and still covers the image', () => {
    const grid = heatmapGrid(plane, 2);
    expect([grid.width, grid.height]).toEqual([100, 50]);
    expect(grid.u_mm[0] * grid.width).toBeCloseTo(0.5 * 401, 6);
    expect(grid.v_mm[1] * grid.height).toBeCloseTo(0.5 * 200, 6);
    expect(grid.origin_mm).toEqual(plane.origin_mm);
  });

  it('keeps image pixels coarser than a voxel, up to the 512 cap', () => {
    const coarse = { ...plane, u_mm: [4, 0, 0], v_mm: [0, 4, 0] } as ViewPlane;
    expect(heatmapGrid(coarse, 2).width).toBe(401);
    const large = { ...coarse, dim_px: [2000, 1000] } as ViewPlane;
    const grid = heatmapGrid(large, 2);
    expect([grid.width, grid.height]).toEqual([MAX_GRID_SIDE, MAX_GRID_SIDE]);
    expect(grid.u_mm[0] * grid.width).toBeCloseTo(4 * 2000, 3);
  });

  it('reads the smallest voxel spacing from an oblique affine', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(voxelSizeMm([3, 0, 0, 0, 0, 2 * c, 2 * s, 0, 0, -4 * s, 4 * c, 0, 9, 9, 9, 1])).toBeCloseTo(2, 6);
    expect(voxelSizeMm(null)).toBeNull();
    // Without a voxel size the grid stays at image resolution.
    expect(heatmapGrid(plane, null).width).toBe(401);
  });
});

describe('temporal heatmap placement', () => {
  it.each(['axial', 'coronal', 'sagittal'] as const)('letterboxed %s: it lands on the image', (axis) => {
    const plane = planeFor(axis, voxelWorld(7, 11, 5));
    const placement = placementFor(plane);
    expect(placement.x > 0 || placement.y > 0).toBe(true);
    expectAligned(plane, placement);
  });

  it('mirrored (radiological): it follows the image, flipped', () => {
    const plane = planeFor('axial', voxelWorld(7, 11, 5));
    const placement = { ...placementFor(plane), mirrorX: true };
    const transform = expectAligned(plane, placement);
    // Grid columns run right to left, from the placement's right edge.
    expect(transform[0]).toBeLessThan(0);
    expect(transform[4]).toBeCloseTo(placement.x + placement.width, 6);
  });

  it('zoomed: it follows the zoomed plane', () => {
    const fitted = planeFor('axial', voxelWorld(7, 11, 5));
    const zoomed = zoomPanPlane({
      plane: fitted,
      placement: placementFor(fitted),
      canvas: CANVAS,
      anchor: { canvasX: 180, canvasY: 120 },
      factor: 3,
      pan: { dx: 15, dy: -5 },
    })!;
    const full = { x: 0, y: 0, width: CANVAS[0], height: CANVAS[1], imageWidth: CANVAS[0], imageHeight: CANVAS[1] };
    expectAligned(zoomed, full);
  });

  it('an oblique view is placed like any other', () => {
    const r = Math.SQRT1_2;
    const oblique: ViewPlane = {
      origin_mm: [-50, -30, 40],
      u_mm: [r, r, 0],
      v_mm: [0.5, -0.5, -r],
      dim_px: [200, 150],
    };
    const placement = { x: 10, y: 20, width: 400, height: 300, imageWidth: 200, imageHeight: 150 };
    expectAligned(oblique, placement);
    expectAligned(oblique, { ...placement, mirrorX: true });
  });

  it('a map of an earlier plane stays where its world is after a pan', () => {
    const fitted = planeFor('axial', voxelWorld(7, 11, 5));
    const placement = placementFor(fitted);
    const grid = heatmapGrid(fitted, 2);
    const panned: ViewPlane = {
      ...fitted,
      origin_mm: [fitted.origin_mm[0] + 10 * fitted.u_mm[0], fitted.origin_mm[1], fitted.origin_mm[2]],
    };
    const before = heatmapCanvasTransform(grid, fitted, placement)!;
    const after = heatmapCanvasTransform(grid, panned, placement)!;
    const scale = placement.width / placement.imageWidth;
    expect(after[4] - before[4]).toBeCloseTo(-10 * scale, 6);
  });

  it('waits for a usable placement', () => {
    const plane = planeFor('axial', voxelWorld(7, 11, 5));
    expect(heatmapCanvasTransform(heatmapGrid(plane, 2), plane, null)).toBeNull();
  });
});

describe('temporal heatmap colour', () => {
  it('scales to the 2nd and 98th percentiles of finite values', () => {
    // 0..100, then masked-out NaN and one huge vessel past the top percentile.
    const values = Array.from({ length: 101 }, (_, i) => i);
    const [low, high] = heatmapColorScale([NaN, ...values, NaN, Infinity])!;
    expect(low).toBeCloseTo(2, 6);
    expect(high).toBeCloseTo(98, 6);
  });

  it('a few vessels do not flatten it', () => {
    const data = Array.from({ length: 1000 }, (_, i) => (i < 5 ? 1e6 : 100 + (i % 100)));
    const [, high] = heatmapColorScale(data)!;
    expect(high).toBeLessThan(200);
    // Values in the body of the map span the colour range.
    const rgba = heatmapRgba(data);
    const greenAt = (i: number) => rgba[i * 4 + 1];
    expect(greenAt(199)).toBeGreaterThan(greenAt(100) + 50); // values 199 and 100
  });

  it('falls back to the full range for a nearly uniform map, and survives a flat one', () => {
    const mostlyZero = Array.from({ length: 1000 }, (_, i) => (i === 0 ? 7 : 0));
    expect(heatmapColorScale(mostlyZero)).toEqual([0, 7]);
    expect(heatmapColorScale([3, 3, 3])).toEqual([3, 3]);
    expect(heatmapRgba([3, 3])[3]).toBe(255);
    expect(heatmapColorScale([NaN])).toBeNull();
  });

  it('leaves NaN transparent, in row-major order', () => {
    const rgba = heatmapRgba([1, NaN, 2, Infinity]);
    expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([255, 0, 255, 0]);
    expect(heatmapRgba([NaN, NaN]).every((v) => v === 0)).toBe(true);
  });
});

describe('TemporalHeatmapOverlay', () => {
  const plane = planeFor('axial', voxelWorld(7, 11, 5));
  const nextSlice: ViewPlane = {
    ...plane,
    origin_mm: [plane.origin_mm[0], plane.origin_mm[1], plane.origin_mm[2] + 2],
  };
  const props = {
    volumeId: 'v',
    metric: 'variance' as const,
    width: 500,
    height: 300,
    viewPlane: plane,
    placement: placementFor(plane),
    voxelToWorld: affine,
  };
  const map = (value: number): TemporalMetricMap => ({
    width: 2,
    height: 1,
    data: Float32Array.of(value, NaN),
  });

  let drawn: Array<CanvasImageSource>;
  let putImages: Array<Uint8ClampedArray>;

  beforeEach(() => {
    vi.useFakeTimers();
    drawn = [];
    putImages = [];
    service.peekPlaneMap.mockReset().mockReturnValue(null);
    service.getPlaneMap.mockReset();
    // jsdom has no 2D canvas: record what is drawn.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          setTransform: vi.fn(),
          clearRect: vi.fn(),
          drawImage: (image: CanvasImageSource) => drawn.push(image),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: (image: { data: Uint8ClampedArray }) => putImages.push(image.data),
        }) as unknown as CanvasRenderingContext2D,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(HEATMAP_REQUEST_DEBOUNCE_MS);
    });

  it('has no axis-aligned restriction: an oblique affine requests and draws', async () => {
    service.getPlaneMap.mockResolvedValue(map(1));
    const c = Math.cos(Math.PI / 6) * 2;
    const s = Math.sin(Math.PI / 6) * 2;
    render(
      <TemporalHeatmapOverlay
        {...props}
        voxelToWorld={[2, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, -40, -50, -20, 1]}
      />,
    );
    await settle();
    expect(drawn).toHaveLength(1);
    expect(screen.queryByText(/axis-aligned/)).toBeNull();
  });

  it('shows pending, debounces a drag, and requests only where it stops', async () => {
    service.getPlaneMap.mockResolvedValue(map(1));
    const { rerender } = render(<TemporalHeatmapOverlay {...props} />);
    expect(screen.getByTestId('temporal-heatmap-pending').textContent).toBe('Computing variance map…');
    for (let step = 1; step <= 3; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HEATMAP_REQUEST_DEBOUNCE_MS / 2);
      });
      rerender(
        <TemporalHeatmapOverlay
          {...props}
          viewPlane={{ ...plane, origin_mm: [plane.origin_mm[0], plane.origin_mm[1], step] }}
        />,
      );
    }
    expect(service.getPlaneMap).not.toHaveBeenCalled();
    await settle();
    expect(service.getPlaneMap).toHaveBeenCalledTimes(1);
    expect(service.getPlaneMap.mock.calls[0][2].origin_mm[2]).toBe(3);
    expect(screen.queryByTestId('temporal-heatmap-pending')).toBeNull();
  });

  it('a new plane object with the same values does not request again', async () => {
    service.getPlaneMap.mockResolvedValue(map(1));
    const { rerender } = render(<TemporalHeatmapOverlay {...props} />);
    await settle();
    rerender(<TemporalHeatmapOverlay {...props} viewPlane={{ ...plane }} />);
    await settle();
    expect(service.getPlaneMap).toHaveBeenCalledTimes(1);
  });

  it('a cached map shows at once, without a request', async () => {
    service.peekPlaneMap.mockReturnValue(map(1));
    render(<TemporalHeatmapOverlay {...props} />);
    await act(async () => {});
    expect(drawn).toHaveLength(1);
    expect(screen.queryByTestId('temporal-heatmap-pending')).toBeNull();
    expect(service.getPlaneMap).not.toHaveBeenCalled();
  });

  it('drops a stale result that arrives after the newer one', async () => {
    const resolvers: Array<(value: TemporalMetricMap) => void> = [];
    service.getPlaneMap.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const { rerender } = render(<TemporalHeatmapOverlay {...props} />);
    await settle();
    rerender(<TemporalHeatmapOverlay {...props} viewPlane={nextSlice} />);
    await settle();
    expect(resolvers).toHaveLength(2);
    await act(async () => resolvers[1](map(2)));
    expect(screen.queryByTestId('temporal-heatmap-pending')).toBeNull();
    const after = putImages.length;
    await act(async () => resolvers[0](map(1)));
    expect(putImages).toHaveLength(after);
    expect(after).toBe(1);
  });

  it('does not show a map of another metric while the new one is pending', async () => {
    service.getPlaneMap.mockResolvedValueOnce(map(1));
    service.getPlaneMap.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<TemporalHeatmapOverlay {...props} />);
    await settle();
    expect(drawn).toHaveLength(1);
    rerender(<TemporalHeatmapOverlay {...props} metric="mean" />);
    await settle();
    expect(drawn).toHaveLength(1);
    expect(screen.getByTestId('temporal-heatmap-pending').textContent).toBe('Computing mean map…');
  });

  it('shows a failure in the pane, from a bridge error payload, and clears it on success', async () => {
    service.getPlaneMap.mockRejectedValueOnce({ Input: { code: 2011, details: 'requires a 4D volume' } });
    service.getPlaneMap.mockResolvedValue(map(1));
    const { rerender } = render(<TemporalHeatmapOverlay {...props} />);
    await settle();
    const error = screen.getByTestId('temporal-heatmap-error');
    expect(error.textContent).toBe('Variance map failed: requires a 4D volume');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('temporal-heatmap-pending')).toBeNull();
    rerender(<TemporalHeatmapOverlay {...props} viewPlane={nextSlice} />);
    await settle();
    expect(screen.queryByTestId('temporal-heatmap-error')).toBeNull();
    expect(drawn).toHaveLength(1);
  });
});
