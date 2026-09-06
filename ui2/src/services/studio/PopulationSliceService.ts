import { inferenceMethod, inferenceChannel, inferenceActive } from './inferenceCatalog';
import { inferenceIssue } from './populationInference';
import type { PopulationInferenceSpec } from '@/types/population';
import { validatePopulationPartition } from './populationGroups';
import type { PopulationMemberSource } from '@/types/population';
import type { PopulationMask } from '@/types/population';
import {
  resolvePopulationParticipants,
  groupParticipantMembers,
  type ParticipantAggregation,
} from './populationParticipants';
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
export interface PopulationGroupRequest {
  id: string;
  memberIds: string[];
  aggregation?: ParticipantAggregation | null;
}
export interface PopulationGroupData {
  id: string;
  values: (number | null)[];
  validCounts: number[];
  eligibleCount: number;
  unitCount: number;
}
export interface PopulationSliceRequest {
  inference?: PopulationInferenceSpec | null;
  groups?: PopulationGroupRequest[];
  reference?: PopulationGroupRequest | null;
  difference?: boolean;
  focusOnly?: boolean;
  focusWindow?: string[];
  contextKey: string;
  mask?: PopulationMask | null;
  members: PopulationMemberSource[];
  workingMemberIds: string[];
  focusMemberId: string | null;
  crosshairMm: [number, number, number];
  orientation: PopulationOrientation;
  dimPx: [number, number];
  zoom: number;
  summary: PopulationSummary;
  aggregation?: ParticipantAggregation | null;
  cutouts?: {
    wholePlane?: boolean;
    centerMm: [number, number, number];
    widthMm: number;
    dimPx: number;
    memberIds: string[];
  } | null;
}
export interface PopulationSliceQuery {
  groupLabels?: Record<string, string>;
  /** Masks change support, not the compatible effect scale. */
  scaleKey?: string;
  initialScale?: { effectLimit?: number; summaryLimit?: number; summary: PopulationSummary };
  focusOrder?: readonly string[];
  key: string;
  datasetKey: string;
  request: PopulationSliceRequest;
}
export interface PopulationSliceData {
  inference?: Partial<Record<PopulationInferenceSpec['channel'], (number | null)[]>> | null;
  groups?: PopulationGroupData[];
  reference?: PopulationGroupData | null;
  focusWindow?: { memberId: string; values: (number | null)[]; validPixels: number }[];
  plane: ViewPlane;
  centerWorld: [number, number, number];
  contextRange: [number, number] | null;
  summary: (number | null)[];
  focused: (number | null)[];
  validCounts: number[];
  eligibleCount: number;
  unitCount: number;
  sources: { memberId: string; revision: { sha256: string; sourceBytes: number } }[];
  maskRevision?: { sha256: string; sourceBytes: number } | null;
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
  readonly groups: Record<string, ImageBitmap>;
  readonly reference: ImageBitmap | null;
  private readonly releaseShared?: () => void;
  constructor(
    summary: ImageBitmap,
    focused: ImageBitmap,
    cutouts: ImageBitmap | null = null,
    releaseShared?: () => void,
    groups: Record<string, ImageBitmap> = {},
    reference: ImageBitmap | null = null,
  ) {
    this.releaseShared = releaseShared;
    this.groups = groups;
    this.reference = reference;
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
      this.focused.close();
      if (this.releaseShared) this.releaseShared();
      else {
        this.summary.close();
        this.cutouts?.close();
        Object.values(this.groups).forEach((image) => image.close());
        this.reference?.close();
      }
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
  > & {
    withoutFocused?: boolean;
    withoutParticipant?: boolean;
    withoutMembers?: readonly string[];
    groupPage?: number;
  },
) {
  const { source, issue } = buildPopulationSource(state, workspaceId);
  if (!source || !source.members.length)
    return { query: null, issue: issue ?? 'No eligible observations.' };
  const population = resolvePopulation(state);
  const {
    withoutFocused,
    withoutParticipant,
    withoutMembers,
    groupPage = 0,
    ...viewOptions
  } = options;
  const configured = resolvePopulationParticipants(state, population.workingMemberIds);
  if (configured.issue && state.population.participants?.reduction !== 'observations')
    return { query: null, issue: configured.issue };
  const focused = state.selection.activeMemberId;
  if (withoutFocused && withoutParticipant && (!focused || !configured.identity?.has(focused)))
    return {
      query: null,
      issue: 'Participant exclusion requires a declared identity for the focused observation.',
    };
  const excludedParticipant =
    withoutFocused && withoutParticipant && focused ? configured.identity?.get(focused) : null;
  if (withoutMembers?.some((id) => !population.context.memberIds.includes(id)))
    return {
      query: null,
      issue: 'Preview exclusion contains observations outside the current context.',
    };
  const workingMemberIds = withoutMembers
    ? population.workingMemberIds.filter((id) => !withoutMembers.includes(id))
    : withoutFocused
      ? population.workingMemberIds.filter((id) =>
          excludedParticipant
            ? configured.identity?.get(id) !== excludedParticipant
            : id !== focused,
        )
      : population.workingMemberIds;
  const aggregation = configured.aggregation
    ? {
        ...configured.aggregation,
        groups: groupParticipantMembers(configured.identity!, workingMemberIds),
      }
    : null;
  const mode = state.population.presentation.arrangement;
  const configuredTest = state.population.inference;
  const activeTest =
    configuredTest?.featureId === state.selection.activeFeatureId &&
    configuredTest?.setId === state.selection.activeSetId &&
    inferenceActive(configuredTest, mode)
      ? configuredTest
      : null;
  const groupRequest = (id: string, memberIds: readonly string[]): PopulationGroupRequest => {
    const participants = resolvePopulationParticipants(state, memberIds);
    if (participants.issue && state.population.participants?.reduction !== 'observations')
      throw new Error(participants.issue);
    return { id, memberIds: [...memberIds], aggregation: participants.aggregation };
  };
  let groups: PopulationGroupRequest[] = [];
  let reference: PopulationGroupRequest | null = null;
  try {
    if (mode === 'groups' && state.population.partition) {
      const issue = validatePopulationPartition(
        state.population.partition,
        state.selection.activeSetId ?? '',
        population.context.memberIds,
      );
      if (issue) throw new Error(issue);
      groups = state.population.partition.groups
        .slice(groupPage * 4, (groupPage + 1) * 4)
        .map((g) => groupRequest(g.id, g.memberIds));
    }
    if (
      mode === 'comparison' ||
      mode === 'difference' ||
      (activeTest && inferenceMethod(activeTest.method).inputs === 'independentGroups')
    ) {
      if (population.referenceIssue) throw new Error(population.referenceIssue);
      if (!population.referenceMemberIds.length || !workingMemberIds.length)
        throw new Error('Choose nonempty populations A and B before comparing.');
      reference = groupRequest('reference', population.referenceMemberIds);
    }
  } catch (error) {
    return { query: null, issue: error instanceof Error ? error.message : String(error) };
  }
  let inference: PopulationInferenceSpec | undefined;
  if (activeTest) {
    inference = {
      method: activeTest.method,
      role: activeTest.role,
      units: activeTest.units,
      nullValue: activeTest.nullValue,
      independentParticipants: activeTest.independentParticipants,
      channel: activeTest.channel,
      selectionOrigin:
        state.population.working.kind === 'members' ? state.population.working.origin : 'manual',
    };
    const testIssue = inferenceIssue(inference, aggregation, reference?.aggregation);
    if (testIssue) return { query: null, issue: testIssue };
  }
  const request: PopulationSliceRequest = {
    ...viewOptions,
    ...(inference ? { inference, summary: 'mean' as const } : {}),
    ...(groups.length ? { groups, summary: 'mean' as const } : {}),
    ...(reference
      ? { reference, difference: mode === 'difference', summary: 'mean' as const }
      : {}),
    contextKey: source.datasetKey,
    members: source.members,
    ...(source.mask ? { mask: source.mask } : {}),
    workingMemberIds,
    aggregation,
    focusMemberId: source.members.some(
      (member) => member.memberId === state.selection.activeMemberId,
    )
      ? state.selection.activeMemberId
      : null,
  };
  const groupLabels = groups.length
    ? Object.fromEntries(state.population.partition!.groups.map((g) => [g.id, g.label]))
    : undefined;
  return {
    query: {
      groupLabels,
      key: JSON.stringify([request, groupLabels]),
      datasetKey: source.datasetKey,
      scaleKey: source.scaleKey,
      initialScale: state.population.restoredView,
      request,
    },
    issue: null,
  };
}

function validateData(data: PopulationSliceData, query: PopulationSliceQuery) {
  if (
    query.request.mask &&
    (!data.maskRevision?.sha256 ||
      (query.request.mask.expectedSha256 !== undefined &&
        query.request.mask.expectedSha256 !== data.maskRevision.sha256))
  )
    throw new Error('The population result is missing the requested mask revision.');
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
    data.sources.some(
      (source, i) =>
        source.memberId !== ids[i] ||
        (query.request.members[i].expectedSha256 != null &&
          source.revision.sha256 !== query.request.members[i].expectedSha256),
    ) ||
    data.eligibleCount !== query.request.workingMemberIds.length ||
    data.unitCount !==
      (query.request.aggregation?.groups.length ?? query.request.workingMemberIds.length) ||
    data.validCounts.some(
      (count) => !Number.isInteger(count) || count < 0 || count > data.unitCount,
    ) ||
    [...data.plane.origin_mm, ...data.plane.u_mm, ...data.plane.v_mm, ...data.centerWorld].some(
      (v) => !Number.isFinite(v),
    )
  ) {
    throw new Error('Population slice result does not match its query or geometry.');
  }
  const expectedInference = !!query.request.inference && !query.request.focusOnly;
  if (
    expectedInference !== !!data.inference ||
    (data.inference &&
      Object.keys(data.inference).length !==
        inferenceMethod(query.request.inference!.method).channels.length) ||
    (data.inference &&
      inferenceMethod(query.request.inference!.method).channels.some(({ id: channel }) => {
        const values = data.inference![channel];
        return (
          !Array.isArray(values) ||
          values.length !== size ||
          values.some((v) => v !== null && !Number.isFinite(v))
        );
      }))
  )
    throw new Error('Inference channels do not match their declared result.');
  if (
    data.inference &&
    query.request.inference &&
    data.summary.some(
      (value, i) => !Object.is(value, data.inference![query.request.inference!.channel]![i]),
    )
  )
    throw new Error('Displayed inference channel does not match its result family.');
  const expectedGroups = [
    ...(query.request.groups ?? []),
    ...(query.request.reference ? [query.request.reference] : []),
  ];
  const actualGroups = [...(data.groups ?? []), ...(data.reference ? [data.reference] : [])];
  if (
    actualGroups.length !== expectedGroups.length ||
    actualGroups.some((g, i) => {
      const expected = expectedGroups[i];
      const units = expected.aggregation?.groups.length ?? expected.memberIds.length;
      return (
        g.id !== expected.id ||
        g.values.length !== size ||
        g.validCounts.length !== size ||
        g.eligibleCount !== expected.memberIds.length ||
        g.unitCount !== units ||
        g.validCounts.some((n) => !Number.isInteger(n) || n < 0 || n > units)
      );
    })
  )
    throw new Error('Group summaries do not match their declared populations and analysis units.');
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
  // A bounded window of exact observed rasters. The one-second freshness lease
  // forces native source-stamp revalidation during sustained playback.
  private focusCache = new Map<string, (number | null)[]>();
  private focusBase: PopulationSliceDisplay | null = null;
  private releaseBase: (() => void) | null = null;
  private focusExpires = 0;
  private clearFocusCache() {
    this.focusCache.clear();
    this.releaseBase?.();
    this.releaseBase = null;
    this.focusBase = null;
  }
  private samePopulation(a: PopulationSliceQuery, b: PopulationSliceQuery) {
    return (
      a.datasetKey === b.datasetKey &&
      JSON.stringify({ ...a.request, focusMemberId: null }) ===
        JSON.stringify({ ...b.request, focusMemberId: null })
    );
  }
  private sameInference(a: PopulationSliceQuery, b: PopulationSliceQuery) {
    return (
      !!a.request.inference &&
      !!b.request.inference &&
      a.datasetKey === b.datasetKey &&
      JSON.stringify({ ...a.request, inference: { ...a.request.inference, channel: null } }) ===
        JSON.stringify({ ...b.request, inference: { ...b.request.inference, channel: null } })
    );
  }
  private contexts = new Set<string>();
  private scaleDataset: string | null = null;
  private effectLimit: number | null = null;
  private summaryLimits = new Map<string, number>();
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
    this.clearFocusCache();
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
    if (
      force ||
      !query ||
      (this.focusBase &&
        !this.samePopulation(this.focusBase.query, query) &&
        !this.sameInference(this.focusBase.query, query))
    )
      this.clearFocusCache();
    const copy = query ? structuredClone(query) : null;
    this.generation++;
    this.abort?.abort();
    this.pending = copy;
    const scaleKey = query?.scaleKey ?? query?.datasetKey;
    const same = scaleKey === this.scaleDataset;
    if (!same || query?.datasetKey !== this.snapshot.requested?.datasetKey) {
      this.releaseContexts();
    }
    if (!same) {
      this.scaleDataset = scaleKey ?? null;
      this.effectLimit = null;
      this.summaryLimits.clear();
      if (query?.initialScale) {
        const { effectLimit, summaryLimit } = query.initialScale;
        if (effectLimit && Number.isFinite(effectLimit) && effectLimit > 0)
          this.effectLimit = effectLimit;
        if (summaryLimit && Number.isFinite(summaryLimit) && summaryLimit > 0)
          this.summaryLimits.set(populationDisplayKind(query.request), summaryLimit);
      }
    }
    this.publish({
      requested: copy,
      displayed:
        same && query?.datasetKey === this.snapshot.displayed?.query.datasetKey
          ? this.snapshot.displayed
          : null,
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
    const kind = this.snapshot.requested
      ? populationDisplayKind(this.snapshot.requested.request)
      : undefined;
    if (
      !kind ||
      populationSharesEffectScale(this.snapshot.requested!.request) ||
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
    this.clearFocusCache();
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
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.run();
      },
      this.focusBase && this.pending && this.samePopulation(this.focusBase.query, this.pending)
        ? 0
        : this.delayMs,
    );
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
      const base = this.focusBase;
      const focusChanged =
        base &&
        this.snapshot.displayed?.query.request.focusMemberId !== query.request.focusMemberId;
      const reuse = !!focusChanged && this.samePopulation(base.query, query);
      const cached =
        reuse && Date.now() < this.focusExpires
          ? this.focusCache.get(query.request.focusMemberId ?? '')
          : undefined;
      let data: PopulationSliceData;
      let shared = false;
      if (
        base?.data.inference &&
        query.request.inference &&
        this.sameInference(base.query, query) &&
        Date.now() < this.focusExpires
      ) {
        data = { ...base.data, summary: base.data.inference[query.request.inference.channel]! };
      } else if (cached && base) {
        data = { ...base.data, focused: cached, focusWindow: undefined };
        shared = true;
      } else {
        const ids = query.focusOrder ?? query.request.members.map((m) => m.memberId);
        const index = Math.max(0, ids.indexOf(query.request.focusMemberId ?? ''));
        const count = Math.min(
          8,
          Math.floor((8 * 1024 * 1024) / (query.request.dimPx[0] * query.request.dimPx[1] * 8)),
        );
        const focusWindow = [...ids.slice(Math.max(0, index - 1), Math.max(0, index - 1) + count)];
        data = await this.dependencies.evaluate(
          { ...query.request, contextKey, focusOnly: reuse, focusWindow },
          abort.signal,
        );
        if (!this.active || version !== this.generation) return;
        if (reuse && base && data.summary.length === 0) {
          if (
            JSON.stringify([data.sources, data.maskRevision, data.plane]) ===
            JSON.stringify([base.data.sources, base.data.maskRevision, base.data.plane])
          ) {
            data = {
              ...data,
              summary: base.data.summary,
              inference: base.data.inference,
              validCounts: base.data.validCounts,
              cutouts: base.data.cutouts,
              groups: base.data.groups,
              reference: base.data.reference,
            };
            shared = true;
          } else {
            data = await this.dependencies.evaluate(
              { ...query.request, contextKey, focusWindow },
              abort.signal,
            );
            if (!this.active || version !== this.generation) return;
          }
        }
        const window = data.focusWindow ?? [];
        if (
          window.length > count ||
          new Set(window.map((m) => m.memberId)).size !== window.length ||
          window.some(
            (m) =>
              !focusWindow.includes(m.memberId) ||
              m.values.length !== query.request.dimPx[0] * query.request.dimPx[1],
          )
        )
          throw new Error('Focus window does not match its requested observations.');
        this.focusCache.clear();
        for (const member of window) this.focusCache.set(member.memberId, member.values);
        this.focusExpires = Date.now() + 1000;
      }
      data = { ...data, focusWindow: undefined };
      validateData(data, query);
      if (shared && base) {
        const releaseShared = base.images.retain();
        let focused: ImageBitmap;
        try {
          focused = await this.dependencies.bitmap(
            populationRgba(data.focused, base.effectLimit, true),
            ...data.plane.dim_px,
          );
        } catch (error) {
          releaseShared();
          throw error;
        }
        images = new PopulationImages(
          base.images.summary,
          focused,
          base.images.cutouts,
          releaseShared,
          base.images.groups,
          base.images.reference,
        );
        if (!this.active || version !== this.generation) {
          images.release();
          return;
        }
        this.publish({
          requested: query,
          displayed: { ...base, query, data, images },
          pending: false,
          error: null,
        });
        return;
      }
      const range = data.contextRange;
      if (this.effectLimit === null && range)
        this.effectLimit = Math.max(Math.abs(range[0]), Math.abs(range[1])) || 1;
      const effectLimit = this.effectLimit ?? 1;
      const kind = populationDisplayKind(query.request);
      let summaryLimit = populationSharesEffectScale(query.request)
        ? effectLimit
        : this.summaryLimits.get(kind);
      if (summaryLimit === undefined) {
        const channel = query.request.inference ? inferenceChannel(query.request.inference) : null;
        const count = channel?.countPopulation === 'B' ? data.reference?.unitCount : data.unitCount;
        summaryLimit =
          channel?.initialLimit ??
          (channel?.countPopulation || kind === 'coverage'
            ? count || 1
            : data.summary.reduce<number>((max, value) => Math.max(max, Math.abs(value ?? 0)), 0) ||
              1);
        this.summaryLimits.set(kind, summaryLimit);
      }
      const [w, h] = data.plane.dim_px;
      const summary = await this.dependencies.bitmap(
        populationRgba(data.summary, summaryLimit, populationDiverging(query.request)),
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
      const groups: Record<string, ImageBitmap> = Object.create(null);
      let reference: ImageBitmap | null = null;
      try {
        if (data.cutouts) {
          const packed = packPopulationCutouts(data.cutouts, effectLimit);
          cutouts = await this.dependencies.bitmap(packed.rgba, packed.width, packed.height);
        }
        for (const group of data.groups ?? [])
          groups[group.id] = await this.dependencies.bitmap(
            populationRgba(group.values, effectLimit, true),
            w,
            h,
          );
        if (data.reference)
          reference = await this.dependencies.bitmap(
            populationRgba(data.reference.values, effectLimit, true),
            w,
            h,
          );
      } catch (error) {
        summary.close();
        focused.close();
        cutouts?.close();
        Object.values(groups).forEach((image) => image.close());
        reference?.close();
        throw error;
      }
      images = new PopulationImages(summary, focused, cutouts, undefined, groups, reference);
      if (!this.active || version !== this.generation) {
        images.release();
        return;
      }
      this.releaseBase?.();
      this.focusBase = { query, data, images, effectLimit, summaryLimit };
      this.releaseBase = images.retain();
      this.publish({
        requested: query,
        displayed: this.focusBase,
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

export function populationDisplayKind(request: PopulationSliceRequest) {
  return request.inference
    ? `${request.inference.method}:${request.inference.channel}`
    : request.summary;
}
export function populationDiverging(request: PopulationSliceRequest) {
  return request.inference
    ? inferenceChannel(request.inference).scale !== 'nonnegative'
    : request.summary === 'mean';
}

export function populationSharesEffectScale(request: PopulationSliceRequest) {
  return request.inference
    ? inferenceChannel(request.inference).scale === 'effect'
    : request.summary === 'mean';
}
