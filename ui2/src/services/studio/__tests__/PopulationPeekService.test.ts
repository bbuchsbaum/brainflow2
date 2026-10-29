import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PopulationPeekService,
  directionalNeighbour,
  peekValueAt,
  type PopulationPeekTarget,
} from '../PopulationPeekService';
import {
  PopulationSliceService,
  populationSliceStepPoint,
  type PopulationPeekRaster,
  type PopulationSliceData,
  type PopulationSliceQuery,
} from '../PopulationSliceService';

const plane = {
  origin_mm: [0, 0, 0],
  u_mm: [1, 0, 0],
  v_mm: [0, 1, 0],
  dim_px: [2, 2] as [number, number],
};
const raster = (target: PopulationPeekTarget): PopulationPeekRaster => ({
  memberId: target.memberId,
  crosshairMm: [...target.crosshairMm],
  orientation: target.orientation,
  plane,
  values: [1, 2, null, 4],
  revisionKey: 'r',
});
const target = (memberId: string, z = 0): PopulationPeekTarget => ({
  memberId,
  crosshairMm: [0, 0, z],
  orientation: 'axial',
});
function deferredEvaluate() {
  const calls: {
    target: PopulationPeekTarget;
    signal: AbortSignal;
    resolve: () => void;
    reject: (e: unknown) => void;
  }[] = [];
  const evaluate = vi.fn(
    (t: PopulationPeekTarget, signal: AbortSignal) =>
      new Promise<PopulationPeekRaster>((resolve, reject) => {
        calls.push({ target: t, signal, resolve: () => resolve(raster(t)), reject });
      }),
  );
  return { evaluate, calls };
}

describe('PopulationPeekService', () => {
  it('drops a superseded response and aborts its request', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.setScope('s');
    service.request(target('a'));
    service.request(target('b'));
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve();
    await Promise.resolve();
    expect(service.getSnapshot()).toMatchObject({ pending: true, raster: null });
    expect(service.getSnapshot().target?.memberId).toBe('b');
    calls[1].resolve();
    await Promise.resolve();
    expect(service.getSnapshot()).toMatchObject({ pending: false });
    expect(service.getSnapshot().raster?.memberId).toBe('b');
    // The dropped response was not cached either.
    expect(service.cacheSize).toBe(1);
  });

  it('drops a response that arrives after the peek closed', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.setScope('s');
    service.request(target('a'));
    service.request(null);
    calls[0].resolve();
    await Promise.resolve();
    expect(service.getSnapshot()).toEqual({
      target: null,
      raster: null,
      pending: false,
      error: null,
    });
  });

  it('serves repeats from a bounded LRU cache and keeps the same member’s raster while a slice loads', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate, 2);
    service.setScope('s');
    for (const id of ['a', 'b']) {
      service.request(target(id));
      calls.at(-1)!.resolve();
      await Promise.resolve();
    }
    service.request(target('a'));
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toMatchObject({ pending: false });
    // 'a' is now most recent; adding 'c' evicts 'b'.
    service.request(target('c'));
    calls.at(-1)!.resolve();
    await Promise.resolve();
    expect(service.cacheSize).toBe(2);
    service.request(target('a'));
    expect(evaluate).toHaveBeenCalledTimes(3);
    service.request(target('b'));
    expect(evaluate).toHaveBeenCalledTimes(4);
    calls.at(-1)!.resolve();
    await Promise.resolve();
    // A new slice of the same member keeps the old image until the new one arrives.
    service.request(target('b', 3));
    expect(service.getSnapshot()).toMatchObject({ pending: true });
    expect(service.getSnapshot().raster?.crosshairMm).toEqual([0, 0, 0]);
  });

  it('clears the cache when the population scope changes and re-requests the open target', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.setScope('s1');
    service.request(target('a'));
    calls[0].resolve();
    await Promise.resolve();
    service.setScope('s2');
    expect(service.cacheSize).toBe(0);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toMatchObject({ pending: true, raster: null });
  });

  it('re-requests the wanted target when the scope returns after passing through null', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.setScope('s1');
    service.request(target('a'));
    calls[0].resolve();
    await Promise.resolve();
    service.setScope(null);
    expect(service.getSnapshot().raster).toBeNull();
    service.setScope('s2');
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1][0].memberId).toBe('a');
    calls[1].resolve();
    await Promise.resolve();
    expect(service.getSnapshot().raster?.memberId).toBe('a');
  });

  it('sends only the latest same-member target after the one in flight', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.setScope('s');
    service.request(target('a', 0));
    for (let z = 1; z <= 20; z++) service.request(target('a', z));
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].resolve();
    await Promise.resolve();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1][0].crosshairMm).toEqual([0, 0, 20]);
    // The intermediate raster was cached but not shown as the wanted one.
    expect(service.getSnapshot()).toMatchObject({ pending: true });
    calls[1].resolve();
    await Promise.resolve();
    expect(service.getSnapshot().raster?.crosshairMm).toEqual([0, 0, 20]);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('reports errors and the absence of a slice to peek from', async () => {
    const { evaluate, calls } = deferredEvaluate();
    const service = new PopulationPeekService(evaluate);
    service.request(target('a'));
    expect(service.getSnapshot().error).toMatch(/No population slice/);
    service.setScope('s');
    service.request(target('b'));
    calls.at(-1)!.reject(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    expect(service.getSnapshot()).toMatchObject({ pending: false, error: 'boom' });
  });
});

describe('peek helpers', () => {
  it('reads the raster value nearest a world point', () => {
    const r = raster(target('a'));
    expect(peekValueAt(r, [0, 0, 0])).toBe(1);
    expect(peekValueAt(r, [1.2, 0.1, 0])).toBe(2);
    expect(peekValueAt(r, [0, 1, 0])).toBeNull();
    expect(peekValueAt(r, [1, 1, 0])).toBe(4);
    expect(peekValueAt(r, [2.6, 0, 0])).toBeUndefined();
  });

  it('moves by arrow direction to the nearest point ahead, reaching coincident points', () => {
    const points: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 0],
      [5, -8],
      [5, 8],
      [-3, 1],
    ];
    expect(directionalNeighbour(points, 0, 'right')).toBe(1);
    expect(directionalNeighbour(points, 1, 'right')).toBe(2);
    expect(directionalNeighbour(points, 2, 'left')).toBe(1);
    expect(directionalNeighbour(points, 2, 'right')).toBeNull();
    expect(directionalNeighbour(points, 0, 'up')).toBe(3);
    expect(directionalNeighbour(points, 0, 'down')).toBe(4);
    expect(directionalNeighbour(points, 0, 'left')).toBe(5);
  });

  it('steps a point along the plane normal towards +S', () => {
    expect(populationSliceStepPoint(plane, [1, 2, 3], 2)).toEqual([1, 2, 5]);
    expect(
      populationSliceStepPoint({ ...plane, u_mm: [1, 0, 0], v_mm: [0, 0, -1] }, [1, 2, 3], 1),
    ).toEqual([1, 3, 3]);
  });
});

describe('PopulationSliceService.evaluatePeek', () => {
  afterEach(() => vi.useRealTimers());
  const query: PopulationSliceQuery = {
    key: 'k',
    datasetKey: 'dataset',
    request: {
      contextKey: 'dataset',
      members: [
        { memberId: 'a', sourcePath: '/a.nii' },
        { memberId: 'b', sourcePath: '/b.nii' },
      ],
      workingMemberIds: ['a', 'b'],
      focusMemberId: 'a',
      crosshairMm: [0, 0, 0],
      orientation: 'axial',
      dimPx: [2, 1],
      zoom: 1,
      summary: 'mean',
      cutouts: { centerMm: [0, 0, 0], widthMm: 20, dimPx: 4, memberIds: ['a'] },
    },
  };
  const data = (focused: (number | null)[] = [3, 0]): PopulationSliceData => ({
    plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [2, 1] },
    centerWorld: [0.5, 0, 0],
    contextRange: [-3, 5],
    summary: [1, null],
    focused,
    validCounts: [2, 0],
    eligibleCount: 2,
    unitCount: 2,
    sources: ['a', 'b'].map((memberId) => ({
      memberId,
      revision: { sha256: 'hash', sourceBytes: 4 },
    })),
    sourceCacheHit: true,
    cachedBytes: 128,
    sampling: 'nearest',
    cutouts: {
      plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [4, 4] },
      members: [{ memberId: 'a', values: Array(16).fill(1), validPixels: 16 }],
    },
  });

  it('reads one member through the focused-original path without touching the displayed result', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn(async () => data());
    const bitmap = vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap);
    const service = new PopulationSliceService(
      { evaluate, release: vi.fn(async () => {}), bitmap },
      0,
    );
    await expect(
      service.evaluatePeek(
        { memberId: 'b', crosshairMm: [0, 0, 0], orientation: 'axial' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/No population slice/);
    service.request(query);
    await vi.runAllTimersAsync();
    const displayed = service.getSnapshot().displayed!;
    const lensContext = (evaluate.mock.calls[0] as unknown as [{ contextKey: string }])[0]
      .contextKey;
    evaluate.mockResolvedValueOnce({ ...data([7, null]), summary: [], cutouts: null });
    const same = await service.evaluatePeek(
      { memberId: 'b', crosshairMm: [0, 0, 0], orientation: 'axial' },
      new AbortController().signal,
    );
    const sameRequest = (evaluate.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];
    expect(sameRequest).toMatchObject({
      contextKey: lensContext,
      focusOnly: true,
      focusMemberId: 'b',
      focusWindow: [],
      cutouts: query.request.cutouts,
    });
    expect(same).toMatchObject({ memberId: 'b', values: [7, null], orientation: 'axial' });
    evaluate.mockResolvedValueOnce({ ...data([1, 2]), summary: [], cutouts: null });
    await service.evaluatePeek(
      { memberId: 'b', crosshairMm: [0, 0, 4], orientation: 'coronal' },
      new AbortController().signal,
    );
    // Another slice cannot reuse the displayed plane, so cutouts are dropped.
    expect(evaluate.mock.calls.at(-1)![0]).toMatchObject({
      crosshairMm: [0, 0, 4],
      orientation: 'coronal',
      cutouts: null,
    });
    expect(service.getSnapshot().displayed).toBe(displayed);
    expect(service.getSnapshot().requested?.request.focusMemberId).toBe('a');
    expect(bitmap).toHaveBeenCalledTimes(3); // summary, focused and cutouts of the lens result only
    evaluate.mockResolvedValueOnce({ ...data([1]), summary: [] });
    await expect(
      service.evaluatePeek(
        { memberId: 'b', crosshairMm: [0, 0, 0], orientation: 'axial' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/does not match/);
    await expect(
      service.evaluatePeek(
        { memberId: 'z', crosshairMm: [0, 0, 0], orientation: 'axial' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/not in the displayed population/);
    service.stop();
  });
});
