import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';

// ── Mocks ───────────────────────────────────────────────────────

const mockApplyAndRenderViewState = vi.fn().mockResolvedValue({
  width: 128,
  height: 128,
  close: vi.fn(),
} as unknown as ImageBitmap);

const mockGetVolumeBounds = vi.fn().mockResolvedValue({
  min: [-96, -132, -78],
  max: [96, 96, 114],
});

const mockBatchRenderSlices = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    applyAndRenderViewState: mockApplyAndRenderViewState,
    getVolumeBounds: mockGetVolumeBounds,
    batchRenderSlices: mockBatchRenderSlices,
  }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));

vi.mock('@/stores/viewStateStore', () => {
  const state = {
    viewState: {
      crosshair: { world_mm: [0, 0, 0] as [number, number, number], visible: true },
      layers: [
        {
          id: 'layer1',
          volumeId: 'vol1',
          visible: true,
          opacity: 1.0,
          colormap: 'gray',
          intensity: [0, 1000] as [number, number],
          threshold: [0, 0] as [number, number],
        },
      ],
      views: {
        axial: { origin_mm: [-96, 96, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [192, 228] },
        sagittal: {
          origin_mm: [0, 96, 114],
          u_mm: [0, -1, 0],
          v_mm: [0, 0, -1],
          dim_px: [228, 192],
        },
        coronal: {
          origin_mm: [-96, 0, 114],
          u_mm: [1, 0, 0],
          v_mm: [0, 0, -1],
          dim_px: [192, 192],
        },
      },
    },
  };
  const useViewStateStore = ((selector?: (s: typeof state) => any) =>
    selector ? selector(state) : state) as any;
  useViewStateStore.getState = () => state;
  useViewStateStore.subscribe = vi.fn(() => vi.fn());
  return { useViewStateStore };
});

vi.mock('@/stores/renderStateStore', () => {
  const store = {
    setRendering: vi.fn(),
    setImage: vi.fn(),
    setError: vi.fn(),
  };
  const useRenderStateStore = ((selector?: (s: typeof store) => any) =>
    selector ? selector(store) : store) as any;
  useRenderStateStore.getState = () => store;
  return { useRenderStateStore };
});

vi.mock('@/services/ViewPlaneService', () => ({
  getViewPlaneService: () => ({
    calculatePixelSize: (wMm: number, hMm: number, wPx: number, hPx: number) =>
      Math.max(wMm / wPx, hMm / hPx),
    calculateCenteringOffsets: (
      wMm: number,
      hMm: number,
      wPx: number,
      hPx: number,
      ps: number,
    ) => ({
      x: ((wPx - wMm / ps) * ps) / 2,
      y: ((hPx - hMm / ps) * ps) / 2,
    }),
  }),
}));

vi.mock('@/utils/coordinates', () => ({
  CoordinateTransform: {
    worldToScreenUnchecked: (world: [number, number, number], _plane: ViewPlane) =>
      [world[0] + 96, 96 - world[1]] as [number, number],
  },
}));

vi.mock('@/utils/debug', () => ({
  createDebugLogger: () => () => {},
}));

import {
  getMosaicRenderService,
  destroyMosaicRenderService,
  type MosaicRenderRequest,
} from '../MosaicRenderService';

// ── Helpers ─────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/**
 * Flush all pending microtasks by yielding to a macrotask. After this resolves,
 * every microtask-scheduled continuation (grid flush, bounds fetches, and the
 * applyAndRenderViewState call itself up to a pending deferred) has run.
 */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeBitmap = (id: number) =>
  ({ width: id, height: id, close: vi.fn() }) as unknown as ImageBitmap;

/** Build a packed batch_render_slices buffer: header + `count` RGBA slabs. */
function makeBatchBuffer(width: number, height: number, count: number): ArrayBuffer {
  const HEADER = 12;
  const bytesPerSlice = width * height * 4;
  const buffer = new ArrayBuffer(HEADER + count * bytesPerSlice);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  view.setUint32(8, count, true);
  const bytes = new Uint8Array(buffer);
  for (let s = 0; s < count; s++) {
    for (let i = 0; i < bytesPerSlice; i++) {
      bytes[HEADER + s * bytesPerSlice + i] = (s * 31 + i) & 0xff;
    }
  }
  return buffer;
}

// ── Tests ───────────────────────────────────────────────────────

describe('MosaicRenderService', () => {
  beforeEach(() => {
    destroyMosaicRenderService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    destroyMosaicRenderService();
  });

  // ── Singleton lifecycle ─────────────────────────────────────

  describe('singleton lifecycle', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getMosaicRenderService();
      const b = getMosaicRenderService();
      expect(a).toBe(b);
    });

    it('returns a fresh instance after destroy', () => {
      const a = getMosaicRenderService();
      destroyMosaicRenderService();
      const b = getMosaicRenderService();
      expect(a).not.toBe(b);
    });
  });

  // ── cancelRenders / destroy (Map cleanup) ───────────────────

  describe('cancelRenders and destroy', () => {
    it('clears specific cell entries on cancelRenders', async () => {
      const svc = getMosaicRenderService();
      // Render 2 cells to populate internal Maps
      await svc.renderMosaicCell({
        sliceIndex: 0,
        axis: 'axial',
        cellId: 'cell-0',
        width: 128,
        height: 128,
      });
      await svc.renderMosaicCell({
        sliceIndex: 1,
        axis: 'axial',
        cellId: 'cell-1',
        width: 128,
        height: 128,
      });

      expect(svc.getSlicePositionForTag('cell-0')).toBeDefined();
      expect(svc.getSlicePositionForTag('cell-1')).toBeDefined();

      svc.cancelRenders(['cell-0']);
      expect(svc.getSlicePositionForTag('cell-0')).toBeUndefined();
      expect(svc.getSlicePositionForTag('cell-1')).toBeDefined();
    });

    it('clears all entries on destroy', async () => {
      const svc = getMosaicRenderService();
      await svc.renderMosaicCell({
        sliceIndex: 5,
        axis: 'axial',
        cellId: 'cell-5',
        width: 128,
        height: 128,
      });
      expect(svc.getSlicePositionForTag('cell-5')).toBeDefined();

      svc.destroy();
      expect(svc.getSlicePositionForTag('cell-5')).toBeUndefined();
    });
  });

  // ── Slice position storage ──────────────────────────────────

  describe('getSlicePositionForTag', () => {
    it('returns undefined for unknown tags', () => {
      const svc = getMosaicRenderService();
      expect(svc.getSlicePositionForTag('no-such-cell')).toBeUndefined();
    });

    it('stores correct slice position after render', async () => {
      const svc = getMosaicRenderService();
      await svc.renderMosaicCell({
        sliceIndex: 0,
        axis: 'axial',
        cellId: 'axial-0',
        width: 128,
        height: 128,
      });
      const pos = svc.getSlicePositionForTag('axial-0');
      expect(pos).toBeDefined();
      // sliceIndex 0 should be near sliceMin (-78 for axial Z)
      expect(pos!).toBeCloseTo(-78, 0);
    });

    it('stores different positions for different slice indices', async () => {
      const svc = getMosaicRenderService();
      await svc.renderMosaicCell({
        sliceIndex: 0,
        axis: 'axial',
        cellId: 'ax-0',
        width: 128,
        height: 128,
      });
      await svc.renderMosaicCell({
        sliceIndex: 50,
        axis: 'axial',
        cellId: 'ax-50',
        width: 128,
        height: 128,
      });
      const pos0 = svc.getSlicePositionForTag('ax-0')!;
      const pos50 = svc.getSlicePositionForTag('ax-50')!;
      expect(pos50).toBeGreaterThan(pos0);
    });
  });

  // ── Crosshair calculation ───────────────────────────────────

  describe('calculateCrosshairForCell', () => {
    const viewPlane: ViewPlane = {
      origin_mm: [-96, 96, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, -1, 0],
      dim_px: [192, 228],
    };

    it('detects active crosshair when on same slice (within tolerance)', () => {
      const svc = getMosaicRenderService();
      const result = svc.calculateCrosshairForCell([10, 20, 0.5], 'axial', 0, viewPlane);
      expect(result.isActive).toBe(true);
      expect(result.screenCoord).not.toBeNull();
    });

    it('returns mirror crosshair when on different slice', () => {
      const svc = getMosaicRenderService();
      const result = svc.calculateCrosshairForCell([10, 20, 50], 'axial', 0, viewPlane);
      expect(result.isActive).toBe(false);
      expect(result.screenCoord).not.toBeNull();
    });

    it('sagittal crosshair checks X axis', () => {
      const svc = getMosaicRenderService();
      const sagPlane: ViewPlane = {
        origin_mm: [0, 96, 114],
        u_mm: [0, -1, 0],
        v_mm: [0, 0, -1],
        dim_px: [228, 192],
      };
      // crosshair X=10, slice at X=10 → active
      const active = svc.calculateCrosshairForCell([10, 20, 30], 'sagittal', 10, sagPlane);
      expect(active.isActive).toBe(true);

      // crosshair X=10, slice at X=50 → mirror
      const mirror = svc.calculateCrosshairForCell([10, 20, 30], 'sagittal', 50, sagPlane);
      expect(mirror.isActive).toBe(false);
    });

    it('coronal crosshair checks Y axis', () => {
      const svc = getMosaicRenderService();
      const corPlane: ViewPlane = {
        origin_mm: [-96, 0, 114],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, -1],
        dim_px: [192, 192],
      };
      // crosshair Y=0, slice at Y=0 → active
      const active = svc.calculateCrosshairForCell([10, 0, 30], 'coronal', 0, corPlane);
      expect(active.isActive).toBe(true);

      // crosshair Y=0, slice at Y=50 → mirror
      const mirror = svc.calculateCrosshairForCell([10, 0, 30], 'coronal', 50, corPlane);
      expect(mirror.isActive).toBe(false);
    });
  });

  // ── Batched rendering (concurrency) ─────────────────────────

  describe('renderMosaicGrid', () => {
    it('renders all requested cells', async () => {
      const svc = getMosaicRenderService();
      const requests: MosaicRenderRequest[] = Array.from({ length: 6 }, (_, i) => ({
        sliceIndex: i * 10,
        axis: 'axial' as const,
        cellId: `grid-${i}`,
        width: 128,
        height: 128,
      }));

      await svc.renderMosaicGrid(requests);
      expect(mockApplyAndRenderViewState).toHaveBeenCalledTimes(6);
    });

    it('processes in batches of MAX_CONCURRENT_RENDERS (4)', async () => {
      const svc = getMosaicRenderService();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockApplyAndRenderViewState.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
        return { width: 128, height: 128, close: vi.fn() } as unknown as ImageBitmap;
      });

      const requests: MosaicRenderRequest[] = Array.from({ length: 8 }, (_, i) => ({
        sliceIndex: i,
        axis: 'axial' as const,
        cellId: `conc-${i}`,
        width: 128,
        height: 128,
      }));

      await svc.renderMosaicGrid(requests);
      // Batches of 4: first batch 4 concurrent, second batch 4 concurrent
      expect(maxConcurrent).toBeLessThanOrEqual(4);
      expect(mockApplyAndRenderViewState).toHaveBeenCalledTimes(8);
    });

    it('handles partial failures without throwing', async () => {
      const svc = getMosaicRenderService();
      let callCount = 0;
      mockApplyAndRenderViewState.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error('Render failed');
        return { width: 128, height: 128, close: vi.fn() } as unknown as ImageBitmap;
      });

      const requests: MosaicRenderRequest[] = Array.from({ length: 3 }, (_, i) => ({
        sliceIndex: i,
        axis: 'axial' as const,
        cellId: `fail-${i}`,
        width: 128,
        height: 128,
      }));

      // Should not throw despite one cell failing
      await expect(svc.renderMosaicGrid(requests)).resolves.not.toThrow();
    });
  });

  // ── Single cell render ──────────────────────────────────────

  describe('renderMosaicCell', () => {
    it('keeps the anatomy centered by using full cell dimensions in the generated view plane', async () => {
      const svc = getMosaicRenderService();

      await svc.renderMosaicCell({
        sliceIndex: 96,
        axis: 'axial',
        cellId: 'centered-cell',
        width: 128,
        height: 128,
      });

      const [viewStateArg, viewTypeArg, widthArg, heightArg] =
        mockApplyAndRenderViewState.mock.calls[0];
      const view = viewStateArg.views.axial;
      const centerX = view.origin_mm[0] + (view.u_mm[0] * view.dim_px[0]) / 2;
      const centerY = view.origin_mm[1] + (view.v_mm[1] * view.dim_px[1]) / 2;

      expect(svc.getViewPlaneForTag('centered-cell')).toEqual(view);
      expect(viewTypeArg).toBe('axial');
      expect(widthArg).toBe(128);
      expect(heightArg).toBe(128);
      expect(view.dim_px).toEqual([128, 128]);
      expect(centerX).toBeCloseTo(0);
      expect(centerY).toBeCloseTo(-18);
    });

    it('stores slice position and calls apiService', async () => {
      const svc = getMosaicRenderService();
      await svc.renderMosaicCell({
        sliceIndex: 10,
        axis: 'coronal',
        cellId: 'cor-10',
        width: 256,
        height: 256,
      });

      expect(mockApplyAndRenderViewState).toHaveBeenCalledOnce();
      expect(svc.getSlicePositionForTag('cor-10')).toBeDefined();
    });

    it('sets error in store when render fails', async () => {
      mockApplyAndRenderViewState.mockRejectedValueOnce(new Error('GPU error'));
      const svc = getMosaicRenderService();
      const { useRenderStateStore } = await import('@/stores/renderStateStore');
      const store = useRenderStateStore.getState();

      await svc.renderMosaicCell({
        sliceIndex: 0,
        axis: 'axial',
        cellId: 'err-cell',
        width: 128,
        height: 128,
      });

      expect(store.setError).toHaveBeenCalledWith('err-cell', expect.any(Error));
      expect(store.setRendering).toHaveBeenCalledWith('err-cell', false);
    });
  });

  // ── Stale-safe scheduling (epoch guard) ─────────────────────

  describe('stale-safe scheduling', () => {
    it('drops a slow older render when a newer render for the same cell wins', async () => {
      const svc = getMosaicRenderService();
      const { useRenderStateStore } = await import('@/stores/renderStateStore');
      const store = useRenderStateStore.getState();

      const deferreds = [deferred<ImageBitmap>(), deferred<ImageBitmap>()];
      let idx = 0;
      mockApplyAndRenderViewState.mockImplementation(() => deferreds[idx++].promise);

      const req = (sliceIndex: number): MosaicRenderRequest => ({
        sliceIndex,
        axis: 'axial',
        cellId: 'same-cell',
        width: 128,
        height: 128,
      });

      // Start render A, let it reach applyAndRenderViewState (consumes deferred 0).
      const pA = svc.renderMosaicCell(req(0));
      await flushMicrotasks();
      // Start render B for the same cell (consumes deferred 1).
      const pB = svc.renderMosaicCell(req(1));
      await flushMicrotasks();

      const bmpA = fakeBitmap(1);
      const bmpB = fakeBitmap(2);

      // Resolve B first (the winner), then the stale A.
      deferreds[1].resolve(bmpB);
      await flushMicrotasks();
      deferreds[0].resolve(bmpA);
      await Promise.all([pA, pB]);

      const setImageForCell = store.setImage.mock.calls.filter((c) => c[0] === 'same-cell');
      expect(setImageForCell).toHaveLength(1);
      expect(setImageForCell[0][1]).toBe(bmpB);
    });

    it('cancelRenders drops an in-flight render and clears its rendering flag', async () => {
      const svc = getMosaicRenderService();
      const { useRenderStateStore } = await import('@/stores/renderStateStore');
      const store = useRenderStateStore.getState();

      const d = deferred<ImageBitmap>();
      mockApplyAndRenderViewState.mockImplementation(() => d.promise);

      const p = svc.renderMosaicCell({
        sliceIndex: 0,
        axis: 'axial',
        cellId: 'cancel-cell',
        width: 128,
        height: 128,
      });
      await flushMicrotasks(); // reach the pending applyAndRenderViewState

      svc.cancelRenders(['cancel-cell']);
      d.resolve(fakeBitmap(3));
      await p;

      const setImageForCell = store.setImage.mock.calls.filter((c) => c[0] === 'cancel-cell');
      expect(setImageForCell).toHaveLength(0);
      expect(store.setRendering).toHaveBeenCalledWith('cancel-cell', false);
    });
  });

  // ── Grid supersede & coalescing ─────────────────────────────

  describe('grid supersede and coalescing', () => {
    it('supersedes the previous grid generation, dropping its late completions', async () => {
      const svc = getMosaicRenderService();
      const { useRenderStateStore } = await import('@/stores/renderStateStore');
      const store = useRenderStateStore.getState();

      const deferreds: Array<ReturnType<typeof deferred<ImageBitmap>>> = [];
      mockApplyAndRenderViewState.mockImplementation(() => {
        const d = deferred<ImageBitmap>();
        deferreds.push(d);
        return d.promise;
      });

      const cell = (id: string, sliceIndex: number): MosaicRenderRequest => ({
        sliceIndex,
        axis: 'axial',
        cellId: id,
        width: 128,
        height: 128,
      });

      // Grid A: two cells, both reach applyAndRenderViewState and stay pending.
      svc.renderMosaicGrid([cell('g0', 0), cell('g1', 1)]);
      await flushMicrotasks();
      expect(deferreds).toHaveLength(2);

      // Grid B (a later tick): only g0. This supersedes generation of grid A.
      svc.renderMosaicGrid([cell('g0', 2)]);
      await flushMicrotasks();
      expect(deferreds).toHaveLength(3);

      // Resolve every render. Grid A's g0 loses on epoch, grid A's g1 loses on
      // generation, only grid B's g0 paints.
      deferreds.forEach((d, i) => d.resolve(fakeBitmap(i + 1)));
      await flushMicrotasks();

      const g0Calls = store.setImage.mock.calls.filter((c) => c[0] === 'g0');
      const g1Calls = store.setImage.mock.calls.filter((c) => c[0] === 'g1');
      expect(g1Calls).toHaveLength(0); // superseded purely by generation
      expect(g0Calls).toHaveLength(1); // only grid B's render
    });

    it('coalesces two renderMosaicGrid calls in the same tick to the latest grid', async () => {
      const svc = getMosaicRenderService();
      mockApplyAndRenderViewState.mockResolvedValue(fakeBitmap(1));

      const cell = (id: string, sliceIndex: number): MosaicRenderRequest => ({
        sliceIndex,
        axis: 'axial',
        cellId: id,
        width: 128,
        height: 128,
      });

      // Both calls happen synchronously in the same tick; only the latest runs.
      svc.renderMosaicGrid([cell('a0', 0)]);
      svc.renderMosaicGrid([cell('b0', 1), cell('b1', 2)]);
      await flushMicrotasks();

      expect(mockApplyAndRenderViewState).toHaveBeenCalledTimes(2);
    });
  });

  // ── Batch render path (feature-flagged) ─────────────────────

  describe('batch render path', () => {
    it('issues one batch call and paints each cell when the flag is on', async () => {
      const svc = getMosaicRenderService();
      svc.setBatchRenderEnabled(true);
      const { useRenderStateStore } = await import('@/stores/renderStateStore');
      const store = useRenderStateStore.getState();

      mockBatchRenderSlices.mockResolvedValue(makeBatchBuffer(128, 128, 2));

      await svc.renderMosaicGrid([
        { sliceIndex: 0, axis: 'axial', cellId: 'c0', width: 128, height: 128 },
        { sliceIndex: 1, axis: 'axial', cellId: 'c1', width: 128, height: 128 },
      ]);
      await flushMicrotasks();

      expect(mockBatchRenderSlices).toHaveBeenCalledTimes(1);
      // Per-cell path must not be used when the batch path succeeds.
      expect(mockApplyAndRenderViewState).not.toHaveBeenCalled();
      expect(store.setImage.mock.calls.filter((c) => c[0] === 'c0')).toHaveLength(1);
      expect(store.setImage.mock.calls.filter((c) => c[0] === 'c1')).toHaveLength(1);
    });

    it('passes requestedView on each batched view state', async () => {
      const svc = getMosaicRenderService();
      svc.setBatchRenderEnabled(true);
      mockBatchRenderSlices.mockResolvedValue(makeBatchBuffer(128, 128, 2));

      await svc.renderMosaicGrid([
        { sliceIndex: 0, axis: 'axial', cellId: 'r0', width: 128, height: 128 },
        { sliceIndex: 1, axis: 'axial', cellId: 'r1', width: 128, height: 128 },
      ]);
      await flushMicrotasks();

      const [viewStates, widthArg, heightArg] = mockBatchRenderSlices.mock.calls[0];
      expect(widthArg).toBe(128);
      expect(heightArg).toBe(128);
      expect(viewStates).toHaveLength(2);
      for (const vs of viewStates) {
        expect(vs.requestedView).toBeDefined();
        expect(vs.requestedView.type).toBe('axial');
        expect(vs.requestedView.width).toBe(128);
        expect(vs.requestedView.origin_mm).toHaveLength(3);
      }
    });

    it('chunks more than 25 cells into ceil(N/25) batch calls', async () => {
      const svc = getMosaicRenderService();
      svc.setBatchRenderEnabled(true);
      mockBatchRenderSlices.mockImplementation(async (viewStates: unknown[]) =>
        makeBatchBuffer(64, 64, viewStates.length),
      );

      const requests: MosaicRenderRequest[] = Array.from({ length: 26 }, (_, i) => ({
        sliceIndex: i,
        axis: 'axial' as const,
        cellId: `chunk-${i}`,
        width: 64,
        height: 64,
      }));

      await svc.renderMosaicGrid(requests);
      await flushMicrotasks();

      // 26 cells -> chunks of 25 + 1 -> 2 batch calls.
      expect(mockBatchRenderSlices).toHaveBeenCalledTimes(2);
      expect(mockBatchRenderSlices.mock.calls[0][0]).toHaveLength(25);
      expect(mockBatchRenderSlices.mock.calls[1][0]).toHaveLength(1);
    });

    it('splits batch calls by viewport size before dispatching', async () => {
      const svc = getMosaicRenderService();
      svc.setBatchRenderEnabled(true);
      mockBatchRenderSlices.mockImplementation(
        async (viewStates: unknown[], width: number, height: number) =>
          makeBatchBuffer(width, height, viewStates.length),
      );

      await svc.renderMosaicGrid([
        { sliceIndex: 0, axis: 'axial', cellId: 'wide-0', width: 128, height: 128 },
        { sliceIndex: 1, axis: 'axial', cellId: 'small-0', width: 64, height: 64 },
        { sliceIndex: 2, axis: 'axial', cellId: 'wide-1', width: 128, height: 128 },
      ]);
      await flushMicrotasks();

      expect(mockBatchRenderSlices).toHaveBeenCalledTimes(2);
      expect(mockBatchRenderSlices.mock.calls[0][0]).toHaveLength(2);
      expect(mockBatchRenderSlices.mock.calls[0][1]).toBe(128);
      expect(mockBatchRenderSlices.mock.calls[0][2]).toBe(128);
      expect(mockBatchRenderSlices.mock.calls[1][0]).toHaveLength(1);
      expect(mockBatchRenderSlices.mock.calls[1][1]).toBe(64);
      expect(mockBatchRenderSlices.mock.calls[1][2]).toBe(64);
    });

    it('falls back to the per-cell path when the batch call throws', async () => {
      const svc = getMosaicRenderService();
      svc.setBatchRenderEnabled(true);
      mockBatchRenderSlices.mockRejectedValue(new Error('batch backend down'));
      mockApplyAndRenderViewState.mockResolvedValue(fakeBitmap(1));

      await svc.renderMosaicGrid([
        { sliceIndex: 0, axis: 'axial', cellId: 'fb0', width: 128, height: 128 },
        { sliceIndex: 1, axis: 'axial', cellId: 'fb1', width: 128, height: 128 },
      ]);
      await flushMicrotasks();

      expect(mockBatchRenderSlices).toHaveBeenCalledTimes(1);
      // Fell back to per-cell rendering for both cells.
      expect(mockApplyAndRenderViewState).toHaveBeenCalledTimes(2);
    });

    it('keeps the per-cell path when the flag is off (default)', async () => {
      const svc = getMosaicRenderService();
      mockApplyAndRenderViewState.mockResolvedValue(fakeBitmap(1));

      await svc.renderMosaicGrid([
        { sliceIndex: 0, axis: 'axial', cellId: 'off0', width: 128, height: 128 },
        { sliceIndex: 1, axis: 'axial', cellId: 'off1', width: 128, height: 128 },
      ]);
      await flushMicrotasks();

      expect(mockBatchRenderSlices).not.toHaveBeenCalled();
      expect(mockApplyAndRenderViewState).toHaveBeenCalledTimes(2);
    });
  });
});
