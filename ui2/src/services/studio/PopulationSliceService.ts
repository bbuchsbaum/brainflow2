import { getTransport } from '@/services/transport';
import { formatTauriError } from '@/utils/formatTauriError';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { buildPopulationSource, populationSupportKey } from './PopulationProbeController';
import { resolvePopulation } from './populationContext';
import type { ViewPlane } from '@/types/coordinates';

export type PopulationSummary = 'mean' | 'sampleSd' | 'meanAbsolute' | 'cancellation' | 'coverage';
export type PopulationOrientation = 'axial' | 'coronal' | 'sagittal';
export interface PopulationSliceRequest {
  contextKey: string;
  members: { memberId: string; sourcePath: string }[];
  workingMemberIds: string[];
  focusMemberId: string | null;
  crosshairMm: [number, number, number];
  orientation: PopulationOrientation;
  dimPx: [number, number];
  zoom: number;
  summary: PopulationSummary;
  cutouts?: {
    centerMm: [number, number, number];
    widthMm: number;
    dimPx: number;
    memberIds: string[];
  } | null;
}
export interface PopulationSliceQuery {
  key: string;
  datasetKey: string;
  request: PopulationSliceRequest;
}
export interface PopulationSliceData {
  plane: ViewPlane;
  centerWorld: [number, number, number];
  contextRange: [number, number] | null;
  summary: (number | null)[];
  focused: (number | null)[];
  validCounts: number[];
  eligibleCount: number;
  sources: { memberId: string; revision: { sha256: string; sourceBytes: number } }[];
  sourceCacheHit: boolean;
  cachedBytes: number;
  sampling: 'nearest';
  cutouts?: {
    plane: ViewPlane;
    members: { memberId: string; values: (number | null)[]; validPixels: number }[];
  } | null;
}

/** The service and committed React views each hold a lease. Replacing a result
 * cannot close a bitmap that a still-mounted viewport may redraw. */
export class PopulationImages {
  private references = 1;
  readonly summary: ImageBitmap;
  readonly focused: ImageBitmap;
  readonly cutouts: ImageBitmap | null;
  constructor(summary: ImageBitmap, focused: ImageBitmap, cutouts: ImageBitmap | null = null) {
    this.summary = summary;
    this.focused = focused;
    this.cutouts = cutouts;
  }
  retain() {
    if (this.references === 0) throw new Error('Population image lease is closed.');
    this.references++;
    return () => this.release();
  }
  release() {
    if (this.references <= 0) return;
    if (--this.references === 0) {
      this.summary.close();
      this.focused.close();
      this.cutouts?.close();
    }
  }
}
export interface PopulationSliceDisplay {
  query: PopulationSliceQuery;
  data: PopulationSliceData;
  images: PopulationImages;
  effectLimit: number;
  summaryLimit: number;
}
interface Snapshot {
  requested: PopulationSliceQuery | null;
  displayed: PopulationSliceDisplay | null;
  pending: boolean;
  error: string | null;
}
interface Dependencies {
  evaluate: (request: PopulationSliceRequest, signal: AbortSignal) => Promise<PopulationSliceData>;
  release: (contextKey: string) => Promise<void>;
  bitmap: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<ImageBitmap>;
}
const native: Dependencies = {
  async evaluate(request, signal) {
    signal.throwIfAborted();
    const ticket = { id: crypto.randomUUID(), expiresAtMs: Date.now() + 120_000 };
    const cancel = () => {
      void Promise.resolve()
        .then(() => getTransport().invoke('cancel_population_sample', { ticket }))
        .catch((error) => console.warn('[PopulationSliceService] Cancellation failed:', error));
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await getTransport().invoke<PopulationSliceData>('evaluate_population_slice', {
        request,
        ticket,
      });
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  },
  async release(contextKey) {
    await getTransport().invoke('release_population_slice', { contextKey });
  },
  async bitmap(rgba, width, height) {
    const pixels = new ImageData(width, height);
    pixels.data.set(rgba);
    return createImageBitmap(pixels);
  },
};

/** Explicit blue-white-red effect palette; nonnegative descriptive summaries
 * use a separate dark-to-gold palette and scale. Unavailable pixels are clear. */
export function populationRgba(
  values: readonly (number | null)[],
  limit: number,
  diverging: boolean,
) {
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) return;
    const amount = Math.min(1, Math.abs(value) / limit);
    const end = diverging ? (value < 0 ? [45, 100, 210] : [205, 55, 55]) : [240, 180, 45];
    const start = diverging ? [240, 240, 240] : [20, 25, 32];
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = start[c] + amount * (end[c] - start[c]);
    pixels[i * 4 + 3] = 255;
  });
  return pixels;
}

export function buildPopulationSliceQuery(
  state: ReturnType<typeof useSetStudioStore.getState>,
  workspaceId: string,
  options: Pick<
    PopulationSliceRequest,
    'crosshairMm' | 'orientation' | 'dimPx' | 'zoom' | 'summary' | 'cutouts'
  > & { withoutFocused?: boolean },
) {
  const { source, issue } = buildPopulationSource(state, workspaceId);
  if (!source || !source.members.length)
    return { query: null, issue: issue ?? 'No eligible observations.' };
  const population = resolvePopulation(state);
  const { withoutFocused, ...viewOptions } = options;
  const request: PopulationSliceRequest = {
    ...viewOptions,
    contextKey: source.datasetKey,
    members: source.members,
    workingMemberIds: withoutFocused
      ? population.workingMemberIds.filter((id) => id !== state.selection.activeMemberId)
      : population.workingMemberIds,
    focusMemberId: source.members.some(
      (member) => member.memberId === state.selection.activeMemberId,
    )
      ? state.selection.activeMemberId
      : null,
  };
  return {
    query: { key: JSON.stringify(request), datasetKey: source.datasetKey, request },
    issue: null,
  };
}

function validateData(data: PopulationSliceData, query: PopulationSliceQuery) {
  const [w, h] = data.plane.dim_px;
  const size = w * h;
  const ids = query.request.members.map((member) => member.memberId);
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    size > 512 * 512 ||
    [data.summary, data.focused, data.validCounts].some((values) => values.length !== size) ||
    data.sources.length !== ids.length ||
    data.sources.some((source, i) => source.memberId !== ids[i]) ||
    data.eligibleCount !== query.request.workingMemberIds.length ||
    [...data.plane.origin_mm, ...data.plane.u_mm, ...data.plane.v_mm, ...data.centerWorld].some(
      (v) => !Number.isFinite(v),
    )
  ) {
    throw new Error('Population slice result does not match its query or geometry.');
  }
  const expected = query.request.cutouts;
  const actual = data.cutouts;
  if (
    !!expected !== !!actual ||
    (expected &&
      actual &&
      (actual.plane.dim_px.some((dim) => dim !== expected.dimPx) ||
        expected.dimPx < 1 ||
        expected.dimPx > 64 ||
        actual.members.length !== expected.memberIds.length ||
        actual.members.length < 1 ||
        actual.members.length > 96 ||
        actual.members.some(
          (member, index) =>
            member.memberId !== expected.memberIds[index] ||
            member.values.length !== expected.dimPx ** 2 ||
            !Number.isInteger(member.validPixels) ||
            member.validPixels < 0 ||
            member.validPixels > member.values.length,
        ) ||
        [...actual.plane.origin_mm, ...actual.plane.u_mm, ...actual.plane.v_mm].some(
          (value) => !Number.isFinite(value),
        )))
  )
    throw new Error('Population cutouts do not match their requested observations or geometry.');
}

/** One bounded sprite sheet for all visible cutouts, with the same value
 * mapping as the focused original. UI layout never resamples source images. */
export function packPopulationCutouts(
  cutouts: NonNullable<PopulationSliceData['cutouts']>,
  limit: number,
) {
  const [cellWidth, cellHeight] = cutouts.plane.dim_px;
  const columns = Math.min(8, cutouts.members.length);
  const width = columns * cellWidth;
  const height = Math.ceil(cutouts.members.length / columns) * cellHeight;
  const rgba = new Uint8ClampedArray(width * height * 4);
  cutouts.members.forEach((member, index) => {
    const pixels = populationRgba(member.values, limit, true);
    const x = (index % columns) * cellWidth,
      y = Math.floor(index / columns) * cellHeight;
    for (let row = 0; row < cellHeight; row++)
      rgba.set(
        pixels.subarray(row * cellWidth * 4, (row + 1) * cellWidth * 4),
        ((y + row) * width + x) * 4,
      );
  });
  return { rgba, width, height, columns };
}

/** Per-mounted-lens owner. One active native request and one latest queued
 * request; CPU arrays and bitmaps stay outside Zustand. */
export class PopulationSliceService {
  private snapshot: Snapshot = { requested: null, displayed: null, pending: false, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;
  private busy = false;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: PopulationSliceQuery | null = null;
  private readonly owner = crypto.randomUUID();
  private contexts = new Set<string>();
  private scaleDataset: string | null = null;
  private effectLimit: number | null = null;
  private summaryLimits = new Map<PopulationSummary, number>();
  private readonly dependencies: Dependencies;
  private readonly delayMs: number;
  constructor(dependencies: Dependencies = native, delayMs = 40) {
    this.dependencies = dependencies;
    this.delayMs = delayMs;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  start() {
    this.active = true;
  }
  stop() {
    this.active = false;
    this.generation++;
    this.abort?.abort();
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.publish({ requested: null, displayed: null, pending: false, error: null });
    this.releaseContexts();
  }
  request(query: PopulationSliceQuery | null, force = false) {
    if (!this.active || (!force && query?.key === this.snapshot.requested?.key)) return;
    const copy = query ? structuredClone(query) : null;
    this.generation++;
    this.abort?.abort();
    this.pending = copy;
    const same = query?.datasetKey === this.scaleDataset;
    if (!same) {
      this.releaseContexts();
      this.scaleDataset = query?.datasetKey ?? null;
      this.effectLimit = null;
      this.summaryLimits.clear();
    }
    this.publish({
      requested: copy,
      displayed: same ? this.snapshot.displayed : null,
      pending: !!copy,
      error: null,
    });
    this.schedule();
  }
  setEffectLimit(limit: number) {
    if (!Number.isFinite(limit) || limit <= 0 || limit === this.effectLimit) return;
    this.effectLimit = limit;
    this.request(this.snapshot.requested, true);
  }
  setSummaryLimit(limit: number) {
    const kind = this.snapshot.requested?.request.summary;
    if (
      !kind ||
      kind === 'mean' ||
      !Number.isFinite(limit) ||
      limit <= 0 ||
      this.summaryLimits.get(kind) === limit
    )
      return;
    this.summaryLimits.set(kind, limit);
    this.request(this.snapshot.requested, true);
  }
  fitEffectScale() {
    const range = this.snapshot.displayed?.data.contextRange;
    if (range) this.setEffectLimit(Math.max(Math.abs(range[0]), Math.abs(range[1])) || 1);
  }
  private releaseContexts() {
    for (const context of this.contexts) {
      void this.dependencies
        .release(context)
        .catch((error) => console.warn('[PopulationSliceService] Release failed:', error));
    }
    this.contexts.clear();
  }
  private publish(next: Snapshot) {
    const previous = this.snapshot.displayed?.images;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
    if (previous !== next.displayed?.images) previous?.release();
  }
  private schedule() {
    if (!this.active || this.busy || this.timer !== null || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }
  private async run() {
    if (!this.active || this.busy || !this.pending) return;
    const query = this.pending;
    this.pending = null;
    this.busy = true;
    const version = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const contextKey = JSON.stringify([this.owner, query.datasetKey]);
    this.contexts.add(contextKey);
    let images: PopulationImages | null = null;
    try {
      const data = await this.dependencies.evaluate({ ...query.request, contextKey }, abort.signal);
      if (!this.active || version !== this.generation) return;
      validateData(data, query);
      const range = data.contextRange;
      if (this.effectLimit === null && range)
        this.effectLimit = Math.max(Math.abs(range[0]), Math.abs(range[1])) || 1;
      const effectLimit = this.effectLimit ?? 1;
      const kind = query.request.summary;
      let summaryLimit = kind === 'mean' ? effectLimit : this.summaryLimits.get(kind);
      if (summaryLimit === undefined) {
        summaryLimit =
          kind === 'coverage'
            ? query.request.members.length
            : data.summary.reduce<number>((max, value) => Math.max(max, value ?? 0), 0) || 1;
        this.summaryLimits.set(kind, summaryLimit);
      }
      const [w, h] = data.plane.dim_px;
      const summary = await this.dependencies.bitmap(
        populationRgba(data.summary, summaryLimit, kind === 'mean'),
        w,
        h,
      );
      let focused: ImageBitmap;
      try {
        focused = await this.dependencies.bitmap(
          populationRgba(data.focused, effectLimit, true),
          w,
          h,
        );
      } catch (error) {
        summary.close();
        throw error;
      }
      let cutouts: ImageBitmap | null = null;
      try {
        if (data.cutouts) {
          const packed = packPopulationCutouts(data.cutouts, effectLimit);
          cutouts = await this.dependencies.bitmap(packed.rgba, packed.width, packed.height);
        }
      } catch (error) {
        summary.close();
        focused.close();
        throw error;
      }
      images = new PopulationImages(summary, focused, cutouts);
      if (!this.active || version !== this.generation) {
        images.release();
        return;
      }
      this.publish({
        requested: query,
        displayed: { query, data, images, effectLimit, summaryLimit },
        pending: false,
        error: null,
      });
    } catch (error) {
      if (this.active && version === this.generation)
        this.publish({ ...this.snapshot, pending: false, error: formatTauriError(error) });
    } finally {
      if (this.abort === abort) this.abort = null;
      this.busy = false;
      this.schedule();
    }
  }
}

export function populationAxisLabel(vector: readonly number[]) {
  const axis = vector.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(vector[best]) ? index : best),
    0,
  );
  return (vector[axis] >= 0 ? ['R', 'A', 'S'] : ['L', 'P', 'I'])[axis];
}

export const populationSliceActions = {
  step(
    workspaceId: string,
    plane: ViewPlane,
    worldMm: [number, number, number],
    distanceMm: number,
  ) {
    const u = plane.u_mm,
      v = plane.v_mm;
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal);
    if (!length) return;
    const axis = normal.reduce(
      (best, value, index) => (Math.abs(value) > Math.abs(normal[best]) ? index : best),
      0,
    );
    const direction = normal[axis] < 0 ? -1 : 1;
    this.navigate(
      workspaceId,
      worldMm.map((value, axis) => value + (direction * distanceMm * normal[axis]) / length) as [
        number,
        number,
        number,
      ],
    );
  },
  hover(
    workspaceId: string,
    worldMm: [number, number, number],
    orientation: PopulationOrientation,
  ) {
    if (
      useViewStateStore.getState().activeWorkspaceKey === workspaceId &&
      worldMm.every(Number.isFinite)
    )
      useMouseCoordinateStore.getState().setMousePosition(worldMm, orientation);
  },
  navigate(workspaceId: string, worldMm: [number, number, number], pin = false) {
    const view = useViewStateStore.getState();
    if (view.activeWorkspaceKey !== workspaceId || !worldMm.every(Number.isFinite)) return;
    // Synchronous canonical update avoids waiting for unrelated renderer resizes.
    view.setViewState((state) => {
      state.crosshair.world_mm = [...worldMm];
    }, workspaceId);
    if (pin) {
      const studio = useSetStudioStore.getState();
      studio.setPopulationProbe(
        {
          supportKey: populationSupportKey(studio, workspaceId),
          worldMm,
          radiusMm: studio.population.pinnedProbe?.radiusMm ?? 0,
          reduce: 'mean',
        },
        'pin',
      );
    }
  },
};
