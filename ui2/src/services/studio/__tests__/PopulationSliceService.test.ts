import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PopulationImages,
  PopulationSliceService,
  populationCountsSummary,
  populationDiverging,
  populationHiddenBand,
  populationOverlayRgba,
  populationAnatomyStatus,
  populationColorbarGradient,
  populationSummaryOpacity,
  POPULATION_NEGATIVE,
  POPULATION_POSITIVE,
  POPULATION_SEQUENTIAL,
  POPULATION_SEQUENTIAL_OPACITY,
  populationRgba,
  populationUnderlayGrey,
  populationUnderlayWindow,
  populationUnderlaySource,
  robustPopulationLimit,
  type PopulationSliceData,
  type PopulationSliceQuery,
  type PopulationSummary,
} from '../PopulationSliceService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const query = (key = 'first', datasetKey = 'dataset'): PopulationSliceQuery => ({
  key,
  datasetKey,
  request: {
    contextKey: datasetKey,
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
  },
});
const data = (): PopulationSliceData => ({
  plane: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [2, 1] },
  centerWorld: [0.5, 0, 0],
  contextRange: [-3, 5],
  summary: [1, null],
  focused: [3, 0],
  validCounts: [2, 0],
  eligibleCount: 2,
  unitCount: 2,
  sources: ['a', 'b'].map((memberId) => ({
    memberId,
    revision: { sha256: 'hash', sourceBytes: 400 },
  })),
  sourceCacheHit: true,
  cachedBytes: 128,
  sampling: 'nearest',
});
function setup() {
  vi.useFakeTimers();
  const evaluate = vi
    .fn<(_request: unknown, signal: AbortSignal) => Promise<PopulationSliceData>>()
    .mockResolvedValue(data());
  const release = vi.fn().mockResolvedValue(undefined);
  const bitmaps: ImageBitmap[] = [];
  const bitmap = vi.fn().mockImplementation(async () => {
    const image = { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    bitmaps.push(image);
    return image;
  });
  const service = new PopulationSliceService({ evaluate, release, bitmap }, 0);
  return { service, evaluate, release, bitmap, bitmaps };
}
afterEach(() => vi.useRealTimers());

describe('PopulationSliceService', () => {
  it('coalesces superseded queries and independently discards a late result', async () => {
    const { service, evaluate, bitmaps } = setup();
    const first = deferred<PopulationSliceData>();
    evaluate.mockReturnValueOnce(first.promise);
    service.request(query());
    await vi.advanceTimersByTimeAsync(0);
    const signal = evaluate.mock.calls[0][1];
    service.request(query('second'));
    service.request(query('latest'));
    expect(signal.aborted).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    first.resolve(data());
    await vi.runAllTimersAsync();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().displayed?.query.key).toBe('latest');
    expect(bitmaps).toHaveLength(2);
    service.stop();
    expect(bitmaps.every((image) => vi.mocked(image.close).mock.calls.length === 1)).toBe(true);
  });
  it('keeps effect scale fixed across focus, selection and slices, until explicit fit', async () => {
    const { service, evaluate } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    // The mean summary [1, null] sets the initial window.
    expect(service.getSnapshot().displayed?.effectLimit).toBe(1);
    evaluate.mockResolvedValue({ ...data(), summary: [40, null], contextRange: [-100, 100] });
    service.request(query('next'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(1);
    service.fitEffectScale();
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(100);
    service.stop();
  });
  it('retains previous result with its own identity while pending and clears across datasets', async () => {
    const { service, evaluate, release } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    const pending = deferred<PopulationSliceData>();
    evaluate.mockReturnValueOnce(pending.promise);
    service.request(query('pending'));
    expect(service.getSnapshot().displayed?.query.key).toBe('first');
    expect(service.getSnapshot().pending).toBe(true);
    service.request(query('new', 'other-dataset'));
    expect(service.getSnapshot().displayed).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    service.stop();
  });
  it('closes bitmaps only after the last mounted viewport releases them', async () => {
    const { service, bitmaps } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    const releaseView = service.getSnapshot().displayed!.images.retain();
    service.request(query('next'));
    await vi.runAllTimersAsync();
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    releaseView();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
    service.stop();
  });
  it('closes completed bitmaps from a superseded asynchronous conversion', async () => {
    const { service, bitmap } = setup();
    const pending = deferred<ImageBitmap>();
    const image = { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    bitmap.mockReturnValueOnce(pending.promise);
    service.request(query());
    await vi.advanceTimersByTimeAsync(0);
    service.stop();
    pending.resolve(image);
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed).toBeNull();
    expect(image.close).toHaveBeenCalledTimes(1);
  });
  it('rejects a mismatched raster or contributing observation identity', async () => {
    const { service, evaluate, bitmap } = setup();
    evaluate.mockResolvedValue({ ...data(), sources: [] });
    service.request(query());
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toMatch(/does not match/);
    expect(bitmap).not.toHaveBeenCalled();
    evaluate.mockResolvedValue({ ...data(), summary: [1] });
    service.request(query('bad raster'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toMatch(/does not match/);
    service.stop();
  });
  it('can stop and restart under StrictMode without retaining an old result', async () => {
    const { service, evaluate } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    service.stop();
    service.start();
    service.request(query());
    await vi.runAllTimersAsync();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().displayed?.query.key).toBe('first');
    service.stop();
  });
});

it('keeps measured zero opaque and missing values transparent with identical effect mapping', () => {
  const pixels = populationRgba([-5, 0, 5, null, NaN], 5, true);
  expect(Array.from(pixels.slice(0, 12))).toEqual([
    45, 100, 210, 255, 240, 240, 240, 255, 205, 55, 55, 255,
  ]);
  expect(Array.from(pixels.slice(12))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});
it('does not reopen a retired image lease', () => {
  const image = { close: vi.fn() } as unknown as ImageBitmap;
  const images = new PopulationImages(image, image);
  images.release();
  expect(() => images.retain()).toThrow(/closed/);
});

it('packs observed cutouts into one image without changing member order or missing pixels', async () => {
  const { packPopulationCutouts } = await import('../PopulationSliceService');
  const cutouts = {
    plane: { ...data().plane, dim_px: [2, 2] as [number, number] },
    members: Array.from({ length: 10 }, (_, i) => ({
      memberId: `m${i}`,
      values: [i, null, 0, -i],
      validPixels: 3,
    })),
  };
  const packed = packPopulationCutouts(cutouts, 10);
  expect([packed.columns, packed.width, packed.height]).toEqual([8, 16, 4]);
  const expected = populationOverlayRgba(cutouts.members[9].values, 10, true, {
    band: populationHiddenBand(10),
  });
  const pixel = (x: number, y: number) =>
    packed.rgba.slice((y * packed.width + x) * 4, (y * packed.width + x + 1) * 4);
  expect(pixel(2, 2)).toEqual(expected.slice(0, 4));
  expect(pixel(3, 2)).toEqual(new Uint8ClampedArray(4));
  expect(pixel(2, 3)).toEqual(expected.slice(8, 12));
});

it('owns the cutout sprite with the view lease and rejects reordered response identities', async () => {
  const { service, evaluate, bitmaps } = setup();
  const request = query();
  request.request.cutouts = { centerMm: [0, 0, 0], widthMm: 2, dimPx: 2, memberIds: ['b', 'a'] };
  const result = {
    ...data(),
    cutouts: {
      plane: { ...data().plane, dim_px: [2, 2] as [number, number] },
      members: ['b', 'a'].map((memberId) => ({
        memberId,
        values: [1, 0, null, 2],
        validPixels: 3,
      })),
    },
  };
  evaluate.mockResolvedValue(result);
  service.request(request);
  await vi.runAllTimersAsync();
  expect(bitmaps).toHaveLength(3);
  expect(service.getSnapshot().displayed?.images.cutouts).toBe(bitmaps[2]);
  const releaseView = service.getSnapshot().displayed!.images.retain();
  service.stop();
  expect(bitmaps[2].close).not.toHaveBeenCalled();
  releaseView();
  expect(bitmaps[2].close).toHaveBeenCalledTimes(1);
  service.start();
  evaluate.mockResolvedValue({
    ...result,
    cutouts: { ...result.cutouts, members: [...result.cutouts.members].reverse() },
  });
  service.request(request);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toMatch(/cutouts do not match/);
  service.stop();
});

it('releases both main images if asynchronous cutout conversion fails', async () => {
  const { service, evaluate, bitmap, bitmaps } = setup();
  const request = query();
  request.request.cutouts = { centerMm: [0, 0, 0], widthMm: 2, dimPx: 2, memberIds: ['a'] };
  evaluate.mockResolvedValue({
    ...data(),
    cutouts: {
      plane: { ...data().plane, dim_px: [2, 2] },
      members: [{ memberId: 'a', values: [1, 2, 3, 4], validPixels: 4 }],
    },
  });
  let conversions = 0;
  bitmap.mockImplementation(async () => {
    if (++conversions === 3) throw new Error('bitmap allocation failed');
    const image = { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    bitmaps.push(image);
    return image;
  });
  service.request(request);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toMatch(/bitmap allocation failed/);
  expect(bitmaps).toHaveLength(2);
  expect(bitmaps.every((image) => vi.mocked(image.close).mock.calls.length === 1)).toBe(true);
  service.stop();
});

it('uses signed world axes and advances the axial plane toward superior for positive steps', async () => {
  const { populationAxisLabel, populationSliceActions } = await import('../PopulationSliceService');
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  const { useSetStudioStore } = await import('@/stores/setStudioStore');
  expect(populationAxisLabel([-2, 0, 0])).toBe('L');
  expect(populationAxisLabel([0, -1, 0])).toBe('P');
  const view = useViewStateStore.getState();
  const pinned = useSetStudioStore.getState().population.pinnedProbe;
  populationSliceActions.step(
    view.activeWorkspaceKey,
    {
      origin_mm: [0, 0, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, -1, 0],
      dim_px: [10, 10],
    },
    [2, 3, 4],
    1,
  );
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([2, 3, 5]);
  expect(useSetStudioStore.getState().population.pinnedProbe).toBe(pinned);
  populationSliceActions.navigate('closed-workspace', [90, 90, 90]);
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([2, 3, 5]);
});

it('refuses coverage counts expressed in rows when the query summarizes participants', async () => {
  const { service, evaluate, bitmap } = setup();
  const request = query();
  request.request.aggregation = {
    within: 'mean',
    groups: [{ participantId: 'P', memberIds: ['a', 'b'] }],
  };
  evaluate.mockResolvedValue({ ...data(), unitCount: 1, validCounts: [2, 0] });
  service.request(request);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toMatch(/does not match/);
  expect(service.getSnapshot().displayed).toBeNull();
  expect(bitmap).not.toHaveBeenCalled();
  service.stop();
});

it('refuses an unmasked result for a masked request before creating bitmaps', async () => {
  const { service, evaluate, bitmap } = setup();
  const masked = query();
  masked.request.mask = { sourcePath: '/mask.nii' };
  service.request(masked);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toMatch(/mask revision/);
  expect(bitmap).not.toHaveBeenCalled();
  evaluate.mockResolvedValue({ ...data(), maskRevision: { sha256: 'mask', sourceBytes: 40 } });
  service.request(masked, true);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toBeNull();
  expect(service.getSnapshot().displayed?.data.maskRevision?.sha256).toBe('mask');
  service.stop();
});

it('preserves the compatible effect scale while replacing masked support', async () => {
  const { service, evaluate } = setup();
  const unmasked = query();
  unmasked.scaleKey = 'feature';
  service.request(unmasked);
  await vi.runAllTimersAsync();
  const limit = service.getSnapshot().displayed!.effectLimit;
  const masked = query('masked', 'masked-support');
  masked.scaleKey = 'feature';
  masked.request.mask = { sourcePath: '/mask.nii' };
  evaluate.mockResolvedValue({
    ...data(),
    contextRange: [-1, 1],
    maskRevision: { sha256: 'mask', sourceBytes: 40 },
  });
  service.request(masked);
  expect(service.getSnapshot().displayed).toBeNull();
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().displayed!.effectLimit).toBe(limit);
  service.stop();
});

it('presents cached original focus without resampling or rebuilding the anchored summary, then revalidates on expiry', async () => {
  const { service, evaluate, bitmap, bitmaps } = setup();
  const first = data();
  first.focusWindow = [{ memberId: 'b', values: [-2, null], validPixels: 1 }];
  evaluate.mockResolvedValue(first);
  service.request(query());
  await vi.runAllTimersAsync();
  const summary = service.getSnapshot().displayed!.images.summary;
  const next = query('focus-b');
  next.request.focusMemberId = 'b';
  service.request(next);
  await vi.runAllTimersAsync();
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(bitmap).toHaveBeenCalledTimes(3);
  expect(service.getSnapshot().displayed!.data.focused).toEqual([-2, null]);
  expect(service.getSnapshot().displayed!.images.summary).toBe(summary);
  await vi.advanceTimersByTimeAsync(1100);
  evaluate.mockResolvedValue({ ...data(), summary: [], validCounts: [], focusWindow: [] });
  service.request(query('back-a'));
  await vi.runAllTimersAsync();
  // Expired windows require native freshness validation before reusing the summary.
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(evaluate.mock.calls[1][0]).toMatchObject({ focusOnly: true });
  expect(service.getSnapshot().error).toBeNull();
  service.stop();
  expect(bitmaps.every((image) => vi.mocked(image.close).mock.calls.length === 1)).toBe(true);
});

it('accepts a focus window sized to the returned plane when it differs from the requested size', async () => {
  // Native framing keeps square pixels, so a 4x4 request can come back as 2x1.
  const { service, evaluate } = setup();
  const requested = query();
  requested.request.dimPx = [4, 4];
  const result = data();
  result.focusWindow = [
    { memberId: 'a', values: [3, 0], validPixels: 2 },
    { memberId: 'b', values: [-2, null], validPixels: 1 },
  ];
  evaluate.mockResolvedValue(result);
  service.request(requested);
  await vi.runAllTimersAsync();
  expect(evaluate.mock.calls[0][0]).toMatchObject({ focusWindow: ['a', 'b'] });
  expect(service.getSnapshot().error).toBeNull();
  expect(service.getSnapshot().displayed!.data.plane.dim_px).toEqual([2, 1]);
  service.stop();
});

it('still rejects focus rasters that do not match the returned plane, and recovers on refresh', async () => {
  const { service, evaluate } = setup();
  const bad = data();
  bad.focusWindow = [{ memberId: 'a', values: [3, 0, 1], validPixels: 3 }];
  evaluate.mockResolvedValueOnce(bad);
  service.request(query());
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toBe('Focus window does not match its requested observations.');
  expect(service.getSnapshot().displayed).toBeNull();
  // "Refresh images" re-issues the same query with force.
  service.request(service.getSnapshot().requested, true);
  await vi.runAllTimersAsync();
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(service.getSnapshot().error).toBeNull();
  expect(service.getSnapshot().displayed?.query.key).toBe('first');
  service.stop();
});

it('does not combine an old summary with a new source revision on a focus-only miss', async () => {
  const { service, evaluate } = setup();
  service.request(query());
  await vi.runAllTimersAsync();
  const changed = {
    ...data(),
    sources: data().sources.map((s) => ({ ...s, revision: { ...s.revision, sha256: 'new' } })),
  };
  evaluate
    .mockResolvedValueOnce({ ...changed, summary: [], validCounts: [] })
    .mockResolvedValueOnce({ ...changed, summary: [9, null] });
  const next = query('b');
  next.request.focusMemberId = 'b';
  service.request(next);
  await vi.runAllTimersAsync();
  expect(evaluate).toHaveBeenCalledTimes(3);
  expect(evaluate.mock.calls[1][0]).toMatchObject({ focusOnly: true });
  expect(service.getSnapshot().displayed!.data.summary).toEqual([9, null]);
  expect(service.getSnapshot().displayed!.data.sources[0].revision.sha256).toBe('new');
  service.stop();
});

it('retains group/reference bitmaps across focus-only results and releases each exactly once', async () => {
  const { service, evaluate, bitmaps } = setup();
  const first = query();
  first.request.reference = { id: 'B', memberIds: ['b'] };
  first.request.groups = [{ id: 'G', memberIds: ['a'] }];
  const group = { id: 'G', values: [3, null], validCounts: [1, 0], eligibleCount: 1, unitCount: 1 };
  evaluate.mockResolvedValue({ ...data(), groups: [group], reference: { ...group, id: 'B' } });
  service.request(first);
  await vi.runAllTimersAsync();
  const initial = service.getSnapshot().displayed!;
  expect(initial.images.groups.G).toBeDefined();
  expect(initial.images.reference).toBeDefined();
  const release = initial.images.retain();
  const next = structuredClone(first);
  next.key = 'focus-b';
  next.request.focusMemberId = 'b';
  evaluate.mockResolvedValue({
    ...data(),
    summary: [],
    validCounts: [],
    groups: [],
    reference: null,
  });
  service.request(next);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toBeNull();
  expect(service.getSnapshot().displayed!.images.groups.G).toBe(initial.images.groups.G);
  expect(service.getSnapshot().displayed!.images.reference).toBe(initial.images.reference);
  service.stop();
  expect(initial.images.reference!.close).not.toHaveBeenCalled();
  release();
  expect(bitmaps.every((b) => vi.mocked(b.close).mock.calls.length === 1)).toBe(true);
});

it('switches retained test channels without resampling within the freshness lease', async () => {
  const { service, evaluate } = setup();
  const q = query();
  q.request.inference = {
    method: 'oneSample',
    role: 'effect',
    units: 'a.u.',
    nullValue: 0,
    independentParticipants: true,
    selectionOrigin: 'manual',
    channel: 'effect',
  };
  q.request.aggregation = {
    within: 'single',
    groups: ['a', 'b'].map((id) => ({ participantId: id, memberIds: [id] })),
  };
  const result = data();
  result.inference = {
    effect: [1, null],
    standardError: [0.5, null],
    t: [2, null],
    df: [1, null],
    count: [2, 0],
  };
  evaluate.mockResolvedValue(result);
  service.request(q);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toBeNull();
  const t = structuredClone(q);
  t.key = 't-channel';
  t.request.inference!.channel = 't';
  service.request(t);
  await vi.runAllTimersAsync();
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(service.getSnapshot().displayed?.data.summary).toEqual([2, null]);
  expect(service.getSnapshot().displayed?.summaryLimit).toBe(5);
  await vi.advanceTimersByTimeAsync(1001);
  const df = structuredClone(q);
  df.key = 'df-channel';
  df.request.inference!.channel = 'df';
  service.request(df);
  await vi.runAllTimersAsync();
  expect(evaluate).toHaveBeenCalledTimes(2);
  evaluate.mockResolvedValue({ ...result, summary: [99, null] });
  service.request(q, true);
  await vi.runAllTimersAsync();
  expect(service.getSnapshot().error).toMatch(/result family/);
  service.stop();
});

describe('population display window from the data', () => {
  /** A sparse beta map: zeros outside the blob, a 1.1 baseline inside, one outlier. */
  const sparse = (size = 400) => {
    const values: (number | null)[] = Array(size).fill(0);
    for (let i = 0; i < 100; i++) values[i] = 1.1;
    values[100] = 0.4;
    values[101] = 50;
    values[size - 1] = null;
    return values;
  };

  it('uses robust percentiles of the nonzero values, ignoring background and outliers', () => {
    expect(robustPopulationLimit(sparse(), true)).toBeCloseTo(1.1);
    expect(robustPopulationLimit([-4, -1, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3], true)).toBe(4);
    expect(robustPopulationLimit([0, 0, null, NaN], true)).toBeNull();
  });

  it('windows a sparse mean around its in-head values instead of a fixed ±1', async () => {
    const { service, evaluate } = setup();
    const size = 400;
    evaluate.mockResolvedValue({
      ...data(),
      plane: { ...data().plane, dim_px: [size, 1] },
      contextRange: [0, 50],
      summary: sparse(size),
      focused: sparse(size),
      validCounts: Array(size).fill(2),
    });
    const q = query();
    q.request.dimPx = [size, 1];
    service.request(q);
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toBeNull();
    expect(service.getSnapshot().displayed?.effectLimit).toBeCloseTo(1.1);
    expect(service.getSnapshot().displayed?.summaryLimit).toBeCloseTo(1.1);
    service.stop();
  });

  it('waits for a slice with data instead of locking an all-zero slice to ±1', async () => {
    const { service, evaluate } = setup();
    evaluate.mockResolvedValue({ ...data(), summary: [0, null], focused: [0, 0] });
    service.request(query());
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(1);
    evaluate.mockResolvedValue({ ...data(), summary: [2.5, null] });
    service.request(query('next'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(2.5);
    service.stop();
  });

  it('keeps a user-set range', async () => {
    const { service, evaluate } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    service.setEffectLimit(7);
    await vi.runAllTimersAsync();
    evaluate.mockResolvedValue({ ...data(), summary: [2.5, null] });
    service.request(query('next'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(7);
    service.stop();
  });

  it('fits a nonnegative summary from its own data', async () => {
    const { service, evaluate } = setup();
    evaluate.mockResolvedValue({ ...data(), summary: [0.3, null] });
    const q = query();
    q.request.summary = 'sampleSd';
    service.request(q);
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.summaryLimit).toBeCloseTo(0.3);
    service.stop();
  });
});

describe('population display over anatomy', () => {
  const pixel = (rgba: Uint8ClampedArray, i: number) => Array.from(rgba.slice(i * 4, i * 4 + 4));

  it('leaves near-zero values transparent without an underlay, never white', () => {
    const rgba = populationOverlayRgba([0, 0.05, -0.05, null, NaN], 1, true, {
      band: populationHiddenBand(1),
    });
    expect(Array.from(rgba)).toEqual(new Array(20).fill(0));
  });

  it('shows the anatomy through near-zero and unavailable values, and colour above the band', () => {
    const underlay = new Float32Array([0.5, 0.5, 0.5, 0.5, Number.NaN]);
    const rgba = populationOverlayRgba([0, null, 1, -1, 0], 1, true, {
      band: populationHiddenBand(1),
      underlay,
    });
    expect(pixel(rgba, 0)).toEqual([100, 100, 100, 255]);
    expect(pixel(rgba, 1)).toEqual([100, 100, 100, 255]);
    // Positive ends deep red, negative deep blue: both saturated, neither grey.
    expect(pixel(rgba, 2)).toEqual([200, 25, 35, 255]);
    expect(pixel(rgba, 3)).toEqual([35, 80, 200, 255]);
    // No anatomy there and nothing to show: transparent onto the dark pane.
    expect(pixel(rgba, 4)).toEqual([0, 0, 0, 0]);
  });

  it('starts each ramp saturated at the hidden band', () => {
    const low = populationOverlayRgba([0.1], 1, true, { band: 0.1 });
    expect(pixel(low, 0)).toEqual([240, 150, 125, 255]);
    const sequential = populationOverlayRgba([0.1, 1, -1], 1, false, { band: 0.1 });
    expect(pixel(sequential, 0)).toEqual([110, 60, 10, 255]);
    expect(pixel(sequential, 1)).toEqual([255, 235, 150, 255]);
    // A nonnegative map has no colour for negative values.
    expect(pixel(sequential, 2)).toEqual([0, 0, 0, 0]);
  });

  it('hides only zero for counts', () => {
    expect(populationHiddenBand(20, true)).toBe(0.5);
    expect(populationHiddenBand(2)).toBeCloseTo(0.2);
    const rgba = populationOverlayRgba([0, 1], 20, false, { band: populationHiddenBand(20, true) });
    expect(pixel(rgba, 0)[3]).toBe(0);
    expect(pixel(rgba, 1)[3]).toBe(255);
  });

  it('windows the anatomy at its robust range and keeps missing samples missing', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const grey = populationUnderlayGrey([...values, null, 0])!;
    expect(grey[0]).toBe(0);
    expect(grey[99]).toBe(1);
    expect(Number.isNaN(grey[100])).toBe(true);
    expect(grey[101]).toBe(0);
    expect(populationUnderlayGrey(null)).toBeNull();
  });

  it('uses a template only when the support declares that template space', () => {
    expect(populationUnderlaySource('MNI152NLin2009cAsym (2mm)')).toEqual({
      sourcePath: 'template:MNI152NLin2009cAsym_brain_1mm',
      issue: null,
    });
    expect(populationUnderlaySource('MNI152NLin6Asym (res-02)').sourcePath).toBe(
      'template:MNI152NLin6Asym_T1w_1mm',
    );
    // Undeclared, native, unknown or mismatched spaces: dark pane, no MNI.
    for (const label of ['97×115×97 voxels · 2.00×2.00×2.00 mm', 'MNI152 2mm template', null])
      expect(populationUnderlaySource(label)).toEqual({
        sourcePath: null,
        issue: 'space not declared',
      });
    for (const label of ['T1w (sub-01)', 'MNI152NLin2009cSym (2mm)', 'toString (grid)'])
      expect(populationUnderlaySource(label).sourcePath).toBeNull();
    expect(populationUnderlaySource('T1w (sub-01)').issue).toBe('no template for T1w');
  });

  it('says briefly why a map has no anatomy', () => {
    const display = (underlayIssue?: string | null, nativeIssue?: string | null) => ({
      query: { ...query(), underlayIssue },
      data: { ...data(), underlayIssue: nativeIssue },
    });
    expect(populationAnatomyStatus(display('space not declared'))).toBe(
      ' · No anatomy: space not declared',
    );
    expect(
      populationAnatomyStatus(display(null, 'The anatomy image does not cover the population grid; they are not in one space.')),
    ).toBe(' · No anatomy: image does not cover the data');
    expect(populationAnatomyStatus(display(null, 'Template X is unavailable: offline'))).toBe(
      ' · No anatomy: anatomy image unavailable',
    );
    expect(populationAnatomyStatus(display())).toBe('');
  });

  it('windows cutout anatomy like the main plane', () => {
    const window = populationUnderlayWindow(Array.from({ length: 100 }, (_, i) => i + 1));
    const cutout = populationUnderlayGrey([3, 51], window)!;
    const own = populationUnderlayGrey([3, 51])!;
    expect(cutout[1]).toBeCloseTo((51 - window[0]) / (window[1] - window[0]));
    expect(own[1]).toBe(1);
  });

  it('uses a sequential map for nonnegative summaries and a symmetric diverging map for signed ones', () => {
    const request = (summary: PopulationSliceQuery['request']['summary']) => ({
      ...query().request,
      summary,
    });
    for (const summary of ['mean', 'median'] as const)
      expect(populationDiverging(request(summary))).toBe(true);
    for (const summary of ['coverage', 'mad', 'sampleSd', 'meanAbsolute', 'cancellation'] as const)
      expect(populationDiverging(request(summary))).toBe(false);
    expect(populationCountsSummary(request('coverage'))).toBe(true);
    expect(populationCountsSummary(request('sampleSd'))).toBe(false);
  });

  it('composes summary and member panes over the returned underlay', async () => {
    const { service, evaluate, bitmap } = setup();
    evaluate.mockResolvedValue({
      ...data(),
      summary: [0, 2],
      focused: [0, null],
      underlay: { values: [10, 20] },
    });
    service.request(query());
    await vi.runAllTimersAsync();
    const [summary, focused] = bitmap.mock.calls.map((call) => call[0] as Uint8ClampedArray);
    // Zero shows the (dark end of the) anatomy, not a white square.
    expect(pixel(summary, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(summary, 1)).toEqual([200, 25, 35, 255]);
    expect(pixel(focused, 1)).toEqual([200, 200, 200, 255]);
    service.stop();
  });

  it('keeps the signed and nonnegative ramps apart: no red in the gold ramp', () => {
    // QA F20: a mostly positive mean looked like SD/coverage when both ramps
    // ran red to yellow. Signed maps are blue–white–red; gold has no red.
    for (const stop of POPULATION_SEQUENTIAL) expect(stop[1]).toBeGreaterThan(stop[2]);
    for (const stop of POPULATION_SEQUENTIAL) expect(stop[1] / stop[0]).toBeGreaterThan(0.5);
    expect(POPULATION_POSITIVE[1][0]).toBeGreaterThan(4 * POPULATION_POSITIVE[1][1]);
    expect(POPULATION_NEGATIVE[1][2]).toBeGreaterThan(2 * POPULATION_NEGATIVE[1][0]);
  });

  it('draws nonnegative summaries translucent over the anatomy (coverage is not a box)', () => {
    const underlay = new Float32Array([0.5, 0.5]);
    const rgba = populationOverlayRgba([72, 0], 72, false, {
      band: populationHiddenBand(72, true),
      underlay,
      opacity: POPULATION_SEQUENTIAL_OPACITY,
    });
    const top = POPULATION_SEQUENTIAL[2];
    const k = POPULATION_SEQUENTIAL_OPACITY;
    // Full coverage shows the anatomy through the gold, not an opaque gold box.
    expect(pixel(rgba, 0)).toEqual([...top.map((c) => Math.round(100 + k * (c - 100))), 255]);
    expect(pixel(rgba, 1)).toEqual([100, 100, 100, 255]);
    // Without anatomy the colour itself is see-through onto the dark pane.
    const bare = populationOverlayRgba([72], 72, false, { band: 0.5, opacity: k });
    expect(pixel(bare, 0)[3]).toBe(Math.round(k * 255));
    const request = (summary: PopulationSummary) => ({ ...query().request, summary });
    expect(populationSummaryOpacity(request('coverage'))).toBe(k);
    expect(populationSummaryOpacity(request('sampleSd'))).toBe(k);
    expect(populationSummaryOpacity(request('mean'))).toBe(1);
  });

  it('renders mean/median diverging and coverage translucent gold in the service itself', async () => {
    const run = async (summary: PopulationSummary) => {
      const { service, evaluate, bitmap } = setup();
      evaluate.mockResolvedValue({
        ...data(),
        summary: [-2, 2],
        focused: [0, 0],
        underlay: { values: [10, 10] },
      });
      service.request({ ...query(), request: { ...query().request, summary } });
      await vi.runAllTimersAsync();
      const rgba = bitmap.mock.calls[0][0] as Uint8ClampedArray;
      service.stop();
      return rgba;
    };
    for (const summary of ['mean', 'median'] as const) {
      const rgba = await run(summary);
      expect(pixel(rgba, 0)).toEqual([...POPULATION_NEGATIVE[1], 255]);
      expect(pixel(rgba, 1)).toEqual([...POPULATION_POSITIVE[1], 255]);
    }
    const coverage = await run('coverage');
    // Negative counts never paint; a positive count is mixed onto the grey.
    expect(pixel(coverage, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(coverage, 1)[0]).toBeLessThan(POPULATION_SEQUENTIAL[2][0]);
    expect(pixel(coverage, 1)[2]).toBeLessThan(POPULATION_SEQUENTIAL[2][2]);
  });

  it('builds the colourbar gradient from the renderer stops', () => {
    const diverging = populationColorbarGradient(true, 0.1);
    expect(diverging).toContain('to top');
    expect(diverging).toContain(`rgb(${POPULATION_NEGATIVE[1].join(', ')}) 0%`);
    expect(diverging).toContain(`rgb(${POPULATION_POSITIVE[1].join(', ')}) 100%`);
    expect(diverging).toContain('transparent 45.00%, transparent 55.00%');
    const sequential = populationColorbarGradient(false, 0.25);
    expect(sequential).toContain('transparent 25.00%');
    expect(sequential).toContain(`rgb(${POPULATION_SEQUENTIAL[2].join(', ')}) 100.00%`);
  });

  it('rejects an underlay that does not match the plane', async () => {
    const { service, evaluate } = setup();
    evaluate.mockResolvedValue({ ...data(), underlay: { values: [1] } });
    service.request(query());
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toMatch(/underlay/);
    service.stop();
  });
});

describe('population opening slice', () => {
  function peakSetup(navigates = true) {
    const context = setup();
    const peak =
      vi.fn<(request: unknown, signal: AbortSignal) => Promise<[number, number, number] | null>>();
    const service = new PopulationSliceService(
      { evaluate: context.evaluate, release: context.release, bitmap: context.bitmap, peak },
      0,
      new Map(),
    );
    const navigate = vi.fn<(world: [number, number, number]) => boolean>(() => navigates);
    service.setPeakNavigator({ scope: 'population:w', navigate });
    service.start();
    return { ...context, service, navigate, peak };
  }
  const at = (
    crosshairMm: [number, number, number],
    summary: PopulationSummary = 'mean',
    key = 'k',
  ) => {
    const q = query(`${key}:${crosshairMm}:${summary}`);
    q.request.crosshairMm = crosshairMm;
    q.request.summary = summary;
    return q;
  };

  it('publishes first, then opens on the peak slice once per dataset and summary', async () => {
    const { service, navigate, peak } = peakSetup();
    const answer = deferred<[number, number, number] | null>();
    peak.mockReturnValueOnce(answer.promise);
    service.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    // The slice is shown before the search answers.
    expect(service.getSnapshot().displayed).not.toBeNull();
    expect(peak).toHaveBeenCalledTimes(1);
    answer.resolve([5, 5, 12]);
    await vi.runAllTimersAsync();
    // Only the slice moves; the in-plane position stays.
    expect(navigate).toHaveBeenCalledWith([0, 0, 12]);
    service.request(at([0, 0, 12]));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(1);
    // Another summary of the same dataset finds its own peak.
    peak.mockResolvedValueOnce([0, 0, 20]);
    service.request(at([0, 0, 12], 'sampleSd'));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith([0, 0, 20]);
    service.stop();
  });

  it("lets the user's slice choice in this lens win", async () => {
    const { service, navigate, peak } = peakSetup();
    const answer = deferred<[number, number, number] | null>();
    peak.mockReturnValueOnce(answer.promise);
    service.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    const signal = peak.mock.calls[0][1];
    service.noteUserSlice();
    expect(signal.aborted).toBe(true);
    answer.resolve([0, 0, 12]);
    await vi.runAllTimersAsync();
    expect(navigate).not.toHaveBeenCalled();
    // Later summaries of this dataset keep the chosen slice too.
    service.request(at([0, 0, 2], 'sampleSd'));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('follows a crosshair moved elsewhere while the search is in flight', async () => {
    const { service, navigate, peak } = peakSetup();
    const answer = deferred<[number, number, number] | null>();
    peak.mockReturnValueOnce(answer.promise);
    service.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    // Recentred by another view (not the user in this lens): still opens on
    // the peak, at the new in-plane position.
    service.request(at([7, -3, 4]));
    await vi.advanceTimersByTimeAsync(0);
    answer.resolve([0, 0, 12]);
    await vi.runAllTimersAsync();
    expect(navigate).toHaveBeenCalledWith([7, -3, 12]);
    service.stop();
  });

  it('retries a refused move on a later slice', async () => {
    const { service, navigate, peak } = peakSetup(false);
    peak.mockResolvedValue([0, 0, 12]);
    service.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    expect(navigate).toHaveBeenCalledTimes(1);
    service.request(at([0, 0, 1]));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(2);
    navigate.mockReturnValue(true);
    service.request(at([0, 0, 2]));
    await vi.runAllTimersAsync();
    service.request(at([0, 0, 12]));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(3);
    service.stop();
  });

  it('stays put without signal, after a failed search, and without a navigator', async () => {
    const { service, navigate, peak } = peakSetup();
    peak.mockResolvedValueOnce(null);
    service.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    service.request(at([0, 0, 0], 'mean', 'again'));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(1);
    peak.mockRejectedValueOnce(new Error('offline'));
    service.request(at([0, 0, 0], 'mad'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toBeNull();
    expect(service.getSnapshot().displayed?.query.request.summary).toBe('mad');
    expect(navigate).not.toHaveBeenCalled();
    service.stop();

    const plain = setup();
    const lone = vi.fn();
    const quiet = new PopulationSliceService(
      { evaluate: plain.evaluate, release: plain.release, bitmap: plain.bitmap, peak: lone },
      0,
      new Map(),
    );
    quiet.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    expect(lone).not.toHaveBeenCalled();
    quiet.stop();
  });

  it('keeps opening-slice memory per lens scope', async () => {
    const memory = new Map();
    const context = setup();
    const peak = vi.fn().mockResolvedValue([0, 0, 12]);
    const deps = { evaluate: context.evaluate, release: context.release, bitmap: context.bitmap, peak };
    const first = new PopulationSliceService(deps, 0, memory);
    first.setPeakNavigator({ scope: 'population:a', navigate: () => true });
    first.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    first.noteUserSlice();
    first.stop();
    const second = new PopulationSliceService(deps, 0, memory);
    second.setPeakNavigator({ scope: 'population:b', navigate: () => true });
    second.start();
    second.request(at([0, 0, 0]));
    await vi.runAllTimersAsync();
    expect(peak).toHaveBeenCalledTimes(2);
    second.stop();
  });
});

describe('anatomy across a summary switch (QA N12)', () => {
  const pixel = (rgba: Uint8ClampedArray, i: number) => Array.from(rgba.slice(i * 4, i * 4 + 4));
  const withUnderlay = (summary: PopulationSummary) => ({
    ...query(summary, 'dataset'),
    request: { ...query(summary, 'dataset').request, summary, underlay: { sourcePath: 'template:T' } },
  });

  it('keeps the anatomy of the same plane when the new summary came back without it', async () => {
    const { service, evaluate, bitmap } = setup();
    evaluate
      .mockResolvedValueOnce({ ...data(), summary: [0, 2], underlay: { values: [10, 20] } })
      .mockResolvedValueOnce({
        ...data(),
        summary: [0, 2],
        underlay: null,
        underlayIssue: 'Template T is unavailable: busy',
      });
    service.request(withUnderlay('mean'));
    await vi.runAllTimersAsync();
    bitmap.mockClear();
    service.request(withUnderlay('coverage'));
    await vi.runAllTimersAsync();
    const summary = bitmap.mock.calls[0][0] as Uint8ClampedArray;
    // Zero coverage shows the anatomy (the darkest grey here), not the dark pane…
    expect(pixel(summary, 0)).toEqual([0, 0, 0, 255]);
    // …and full coverage is translucent over the brighter anatomy, opaque.
    expect(pixel(summary, 1)[3]).toBe(255);
    expect(service.getSnapshot().displayed?.data.underlay?.values).toEqual([10, 20]);
    expect(service.getSnapshot().displayed?.data.underlayIssue).toBeNull();
    service.stop();
  });

  it('asks once more for an anatomy that could not be read', async () => {
    const { service, evaluate } = setup();
    evaluate
      .mockResolvedValueOnce({ ...data(), underlay: null, underlayIssue: 'Template T is unavailable: busy' })
      .mockResolvedValue({ ...data(), underlay: { values: [10, 20] } });
    service.request(withUnderlay('mean'));
    await vi.runAllTimersAsync();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().displayed?.data.underlay?.values).toEqual([10, 20]);
    // A space mismatch is not retried.
    evaluate.mockClear();
    evaluate.mockResolvedValue({
      ...data(),
      underlay: null,
      underlayIssue: 'The anatomy image does not cover the population grid; they are not in one space.',
    });
    service.request({ ...withUnderlay('mean'), key: 'other', datasetKey: 'other' });
    await vi.runAllTimersAsync();
    expect(evaluate).toHaveBeenCalledTimes(1);
    service.stop();
  });
});

describe('a transport that cannot evaluate population slices (review M4)', () => {
  it('reports the slices unavailable instead of a TypeError', async () => {
    const { checkedPopulationSliceData, POPULATION_SLICES_UNAVAILABLE } = await import(
      '../PopulationSliceService'
    );
    for (const answer of [null, undefined, 'x', {}, { summary: [], focused: [] }, { ...data(), plane: null }])
      expect(() => checkedPopulationSliceData(answer)).toThrow(POPULATION_SLICES_UNAVAILABLE);
    expect(checkedPopulationSliceData(data())).toEqual(data());

    const { service, evaluate } = setup();
    evaluate.mockResolvedValue(null as never);
    service.request(query());
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().error).toBe(POPULATION_SLICES_UNAVAILABLE);
    expect(service.getSnapshot().displayed).toBeNull();
    service.stop();
  });

  it('a focus-only read that comes back empty is an error, not a crash', async () => {
    const { POPULATION_SLICES_UNAVAILABLE } = await import('../PopulationSliceService');
    const { service, evaluate } = setup();
    service.request(query());
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed).not.toBeNull();
    evaluate.mockResolvedValue(null as never);
    await expect(
      service.evaluatePeek({ memberId: 'b', crosshairMm: [0, 0, 0], orientation: 'axial' }, new AbortController().signal),
    ).rejects.toThrow(POPULATION_SLICES_UNAVAILABLE);
    service.stop();
  });
});
