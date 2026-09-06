import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PopulationImages,
  PopulationSliceService,
  populationRgba,
  type PopulationSliceData,
  type PopulationSliceQuery,
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
    expect(service.getSnapshot().displayed?.effectLimit).toBe(5);
    evaluate.mockResolvedValue({ ...data(), contextRange: [-100, 100] });
    service.request(query('next'));
    await vi.runAllTimersAsync();
    expect(service.getSnapshot().displayed?.effectLimit).toBe(5);
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

it('uses signed world axes and advances the axial plane toward superior for positive steps', async () => {
  const { populationAxisLabel, populationSliceActions } = await import('../PopulationSliceService');
  const { useViewStateStore } = await import('@/stores/viewStateStore');
  const { useSetStudioStore } = await import('@/stores/setStudioStore');
  expect(populationAxisLabel([-2, 0, 0])).toBe('L');
  expect(populationAxisLabel([0, -1, 0])).toBe('P');
  const view = useViewStateStore.getState();
  const pinned = useSetStudioStore.getState().population.pinnedProbe;
  populationSliceActions.step(view.activeWorkspaceKey, {
    origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [10, 10],
  }, [2, 3, 4], 1);
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([2, 3, 5]);
  expect(useSetStudioStore.getState().population.pinnedProbe).toBe(pinned);
  populationSliceActions.navigate('closed-workspace', [90, 90, 90]);
  expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([2, 3, 5]);
});
