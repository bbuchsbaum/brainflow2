import { inferenceMethod, inferenceChannel, inferenceActive } from './inferenceCatalog';
import { inferenceIssue, importedInferenceIssue } from './populationInference';
import type { PopulationInferenceSpec } from '@/types/population';
import { comparableGroups, validatePopulationPartition } from './populationGroups';
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

export type PopulationSummary =
  | 'mean'
  | 'median'
  | 'mad'
  | 'sampleSd'
  | 'meanAbsolute'
  | 'cancellation'
  | 'coverage';
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
  focusStackIndex?: number;
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
  /** Display-only anatomy sampled under the maps; never a calculation operand. */
  underlay?: { sourcePath: string } | null;
}
export interface PopulationSliceQuery {
  groupLabels?: Record<string, string>;
  /** Masks change support, not the compatible effect scale. */
  scaleKey?: string;
  initialScale?: { effectLimit?: number; summaryLimit?: number; summary: PopulationSummary };
  /** Why no anatomy is requested (short, for the status line). */
  underlayIssue?: string | null;
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
  /** Anatomy on `plane` (and on the cutout plane); null outside the image. */
  underlay?: { values: (number | null)[]; cutouts?: (number | null)[] } | null;
  /** Why a requested underlay is missing; the maps remain valid. */
  underlayIssue?: string | null;
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
  /** Windowed anatomy grey for `data.plane`, kept for focus-only redraws. */
  underlay?: Float32Array | null;
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
  /** The crosshair moved onto the slice with the most summary signal. */
  peak?: (
    request: PopulationSliceRequest,
    signal: AbortSignal,
  ) => Promise<[number, number, number] | null>;
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
  async peak(request, signal) {
    signal.throwIfAborted();
    const ticket = { id: crypto.randomUUID(), expiresAtMs: Date.now() + 120_000 };
    const cancel = () => {
      void Promise.resolve()
        .then(() => getTransport().invoke('cancel_population_sample', { ticket }))
        .catch((error) => console.warn('[PopulationSliceService] Cancellation failed:', error));
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await getTransport().invoke<[number, number, number] | null>(
        'population_peak_slice',
        { request, ticket },
      );
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  },
  async bitmap(rgba, width, height) {
    const pixels = new ImageData(width, height);
    pixels.data.set(rgba);
    return createImageBitmap(pixels);
  },
};

/**
 * A display limit from the data: the larger magnitude of the 2nd and 98th
 * percentiles (signed) or the 98th percentile (nonnegative) of the finite,
 * nonzero values. Zeros are left out because they are mostly outside the
 * head, and would pull a sparse map's window to nothing. Null when the
 * raster holds no such values (an all-zero slice says nothing about scale).
 */
export function robustPopulationLimit(
  values: readonly (number | null)[],
  signed: boolean,
): number | null {
  const finite: number[] = [];
  for (const value of values)
    if (value !== null && Number.isFinite(value) && value !== 0) finite.push(value);
  if (!finite.length) return null;
  finite.sort((a, b) => a - b);
  const at = (p: number) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))];
  const limit = signed ? Math.max(Math.abs(at(0.02)), Math.abs(at(0.98))) : Math.abs(at(0.98));
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

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

/** Share of the display limit hidden around zero, like a stat overlay's
 * threshold: sparse maps are mostly exact zeros, which must not paint. */
export const POPULATION_HIDDEN_FRACTION = 0.1;

/** Values with |v| below this band are transparent. Counts hide only zero. */
export function populationHiddenBand(limit: number, counts = false) {
  return counts ? 0.5 : POPULATION_HIDDEN_FRACTION * limit;
}

/** The anatomy window: the 2nd and 98th percentiles of its finite nonzero
 * values on the main plane. */
export function populationUnderlayWindow(values: readonly (number | null)[]): [number, number] {
  const finite: number[] = [];
  for (const value of values)
    if (value !== null && Number.isFinite(value) && value !== 0) finite.push(value);
  finite.sort((a, b) => a - b);
  const at = (p: number) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))];
  return finite.length ? [at(0.02), at(0.98)] : [0, 1];
}

/** Underlay intensities as 0–1 grey in `window` (by default their own);
 * NaN where there is no anatomy. Null without an underlay. Cutouts take the
 * main plane's window so the same tissue has the same grey everywhere. */
export function populationUnderlayGrey(
  values: readonly (number | null)[] | null | undefined,
  window: [number, number] = values ? populationUnderlayWindow(values) : [0, 1],
): Float32Array | null {
  if (!values) return null;
  const [low, high] = window;
  const span = high > low ? high - low : 1;
  return Float32Array.from(values, (value) =>
    value === null || !Number.isFinite(value)
      ? Number.NaN
      : Math.min(1, Math.max(0, (value - low) / span)),
  );
}

// Colour is data: signed maps run red to yellow above zero and blue to cyan
// below; nonnegative summaries use one dark-red to pale-yellow ramp. Both start
// saturated at the hidden band so the lowest shown value never reads as grey.
const POSITIVE = [
  [200, 30, 30],
  [255, 235, 80],
];
const NEGATIVE = [
  [30, 70, 220],
  [90, 225, 255],
];
const SEQUENTIAL = [
  [150, 25, 10],
  [240, 110, 15],
  [255, 240, 140],
];
/** Brightest underlay grey; kept below white so colour stays legible. */
const UNDERLAY_MAX = 200;

function ramp(stops: readonly (readonly number[])[], t: number) {
  const at = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const f = at - i;
  return [0, 1, 2].map((c) => stops[i][c] + f * (stops[i + 1][c] - stops[i][c]));
}

/**
 * A population map drawn as an overlay: values within the hidden band are
 * transparent onto the anatomy grey, or onto nothing (the dark pane) without
 * one. Signed maps are diverging and symmetric about zero; nonnegative maps
 * are sequential from zero. Unavailable values show the anatomy alone.
 */
export function populationOverlayRgba(
  values: readonly (number | null)[],
  limit: number,
  diverging: boolean,
  options: { band: number; underlay?: Float32Array | null },
) {
  const { band, underlay } = options;
  const pixels = new Uint8ClampedArray(values.length * 4);
  const span = limit > band ? limit - band : limit || 1;
  values.forEach((value, i) => {
    let colour: number[] | null = null;
    if (value !== null && Number.isFinite(value) && Math.abs(value) >= band && (diverging || value > 0)) {
      const t = (Math.abs(value) - band) / span;
      colour = ramp(diverging ? (value < 0 ? NEGATIVE : POSITIVE) : SEQUENTIAL, t);
    } else if (underlay && Number.isFinite(underlay[i])) {
      const grey = underlay[i] * UNDERLAY_MAX;
      colour = [grey, grey, grey];
    }
    if (!colour) return;
    for (let c = 0; c < 3; c++) pixels[i * 4 + c] = colour[c];
    pixels[i * 4 + 3] = 255;
  });
  return pixels;
}

/** Whether a summary is a count, whose only near-zero value is zero. */
export function populationCountsSummary(request: PopulationSliceRequest) {
  return request.inference
    ? !!inferenceChannel(request.inference).countPopulation
    : request.summary === 'coverage';
}

/** Anatomy per declared template space (TemplateFlow IDs the app resolves). */
const SPACE_UNDERLAYS: Record<string, string> = {
  MNI152NLin2009cAsym: 'template:MNI152NLin2009cAsym_brain_1mm',
  MNI152NLin6Asym: 'template:MNI152NLin6Asym_T1w_1mm',
  MNIColin27: 'template:MNIColin27_T1w_native',
  MNI305: 'template:MNI305_T1w_native',
};
/**
 * The anatomy image drawn under a set's population maps, or why there is
 * none. Neither NeuroTabs manifests nor set summaries carry a reference image,
 * so only a support that declares a known template space ("<space> (<grid>)")
 * gets that template. An undeclared, subject-native or unknown space gets the
 * dark pane: a template under native data would misregister. Natively the
 * template must also cover the population grid, or it is reported missing.
 */
export function populationUnderlaySource(supportLabel: string | null | undefined): {
  sourcePath: string | null;
  issue: string | null;
} {
  const space = /^(\S+) \(/.exec(supportLabel ?? '')?.[1];
  if (!space) return { sourcePath: null, issue: 'space not declared' };
  if (!Object.hasOwn(SPACE_UNDERLAYS, space))
    return { sourcePath: null, issue: `no template for ${space}` };
  return { sourcePath: SPACE_UNDERLAYS[space], issue: null };
}

/** A short status hint when a shown population map has no anatomy under it. */
export function populationAnatomyStatus(display: Pick<PopulationSliceDisplay, 'query' | 'data'>) {
  const reason =
    display.query.underlayIssue ??
    (display.data.underlayIssue
      ? /not in one space/.test(display.data.underlayIssue)
        ? 'image does not cover the data'
        : 'anatomy image unavailable'
      : null);
  return reason ? ` · No anatomy: ${reason}` : '';
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
      // The unassigned group of a relationship fit is not a comparison operand.
      groups = comparableGroups(state.population.partition)
        .slice(groupPage * 4, (groupPage + 1) * 4)
        .map((g) => groupRequest(g.id, g.memberIds));
    }
    if (
      mode === 'comparison' ||
      mode === 'difference' ||
      (activeTest &&
        ['independentGroups', 'pairedGroups'].includes(inferenceMethod(activeTest.method).inputs))
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
      ...(activeTest.design ? { design: activeTest.design } : {}),
      role: activeTest.role,
      units: activeTest.units,
      nullValue: activeTest.nullValue,
      independentParticipants: activeTest.independentParticipants,
      channel: activeTest.channel,
      selectionOrigin:
        state.population.working.kind === 'members' ? state.population.working.origin : 'manual',
    };
    const testIssue =
      importedInferenceIssue(inference, state.features[state.selection.activeFeatureId ?? '']) ??
      inferenceIssue(inference, aggregation, reference?.aggregation);
    if (testIssue) return { query: null, issue: testIssue };
  }
  const underlay = populationUnderlaySource(
    state.sets[state.selection.activeSetId ?? '']?.supportLabel,
  );
  const request: PopulationSliceRequest = {
    ...viewOptions,
    ...(underlay.sourcePath ? { underlay: { sourcePath: underlay.sourcePath } } : {}),
    ...(inference ? { inference, summary: 'mean' as const } : {}),
    ...(groups.length ? { groups, summary: 'mean' as const } : {}),
    ...(reference
      ? { reference, difference: mode === 'difference', summary: 'mean' as const }
      : {}),
    contextKey: source.datasetKey,
    members: source.members,
    ...(source.mask ? { mask: source.mask } : {}),
    workingMemberIds,
    ...(state.population.focusedFrame?.memberId === state.selection.activeMemberId
      ? { focusStackIndex: state.population.focusedFrame.frame }
      : {}),
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
      underlayIssue: underlay.issue,
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
  const underlay = data.underlay;
  if (
    underlay &&
    (underlay.values.length !== size ||
      (underlay.cutouts != null &&
        (!data.cutouts ||
          underlay.cutouts.length !== data.cutouts.plane.dim_px[0] * data.cutouts.plane.dim_px[1])))
  )
    throw new Error('Population underlay does not match its planes.');
}

/** Opening-slice state per lens scope (lens and workspace) and dataset
 * scale, across lens mounts. `chosen` is set by a slice the user picks in
 * that lens, which then wins for every summary of the dataset. */
interface PeakState {
  chosen: boolean;
  done: Set<string>;
}
const peakMemory = new Map<string, PeakState>();
const PEAK_MEMORY_LIMIT = 64;
/** Crosshairs within this distance (mm) are the same slice position. */
const CROSSHAIR_TOLERANCE_MM = 1e-3;
/** World axis of each view's normal (population views are world-aligned). */
const NORMAL_AXIS: Record<PopulationOrientation, number> = { sagittal: 0, coronal: 1, axial: 2 };

/** Moves the view; false when it cannot (another workspace is active). */
export interface PopulationPeakNavigator {
  /** Lens and workspace the opening-slice memory belongs to. */
  scope: string;
  navigate: (worldMm: [number, number, number]) => boolean;
}

/** One bounded sprite sheet for all visible cutouts, with the same value
 * mapping as the focused original over the cutout plane's anatomy. UI layout
 * never resamples source images. */
export function packPopulationCutouts(
  cutouts: NonNullable<PopulationSliceData['cutouts']>,
  limit: number,
  underlay: Float32Array | null = null,
) {
  const [cellWidth, cellHeight] = cutouts.plane.dim_px;
  const columns = Math.min(8, cutouts.members.length);
  const width = columns * cellWidth;
  const height = Math.ceil(cutouts.members.length / columns) * cellHeight;
  const rgba = new Uint8ClampedArray(width * height * 4);
  cutouts.members.forEach((member, index) => {
    const pixels = populationOverlayRgba(member.values, limit, true, {
      band: populationHiddenBand(limit),
      underlay,
    });
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
      JSON.stringify({ ...a.request, focusMemberId: null, focusStackIndex: null }) ===
        JSON.stringify({ ...b.request, focusMemberId: null, focusStackIndex: null })
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
  private readonly peaks: Map<string, PeakState>;
  private navigator: PopulationPeakNavigator | null = null;
  private peakAbort: AbortController | null = null;
  private peakKey: string | null = null;
  private peakDataset: string | null = null;
  constructor(dependencies: Dependencies = native, delayMs = 40, peaks = peakMemory) {
    this.dependencies = dependencies;
    this.delayMs = delayMs;
    this.peaks = peaks;
  }
  /** Where the view moves to open on the slice with the most signal. Without
   * one, no peak is searched. */
  setPeakNavigator(navigator: PopulationPeakNavigator | null) {
    if (navigator?.scope !== this.navigator?.scope) this.cancelPeak();
    this.navigator = navigator;
  }
  /** The user picked a slice in this lens: it wins for the shown dataset. */
  noteUserSlice() {
    const query = this.snapshot.requested ?? this.snapshot.displayed?.query;
    const entry = query && this.peakEntry(query);
    if (entry) entry.chosen = true;
    this.cancelPeak();
  }
  private peakEntry(query: PopulationSliceQuery, create = false) {
    if (!this.navigator) return null;
    const key = JSON.stringify([this.navigator.scope, query.scaleKey ?? query.datasetKey]);
    let entry = this.peaks.get(key);
    if (!entry && create) {
      if (this.peaks.size >= PEAK_MEMORY_LIMIT) this.peaks.delete(this.peaks.keys().next().value!);
      entry = { chosen: false, done: new Set() };
      this.peaks.set(key, entry);
    }
    return entry ?? null;
  }
  private cancelPeak() {
    this.peakAbort?.abort();
    this.peakAbort = null;
    this.peakKey = null;
    this.peakDataset = null;
  }
  /** After a full slice is shown, search for the opening slice once per
   * dataset and summary. The search runs beside slice evaluation, so it
   * never delays a displayed slice. */
  private startPeak(query: PopulationSliceQuery) {
    const kind = populationDisplayKind(query.request);
    const entry = this.peakEntry(query, true);
    const peak = this.dependencies.peak;
    const navigator = this.navigator;
    if (!entry || !peak || !navigator || entry.chosen || entry.done.has(kind)) return;
    const key = JSON.stringify([navigator.scope, query.scaleKey ?? query.datasetKey, kind]);
    if (this.peakKey === key) return;
    this.cancelPeak();
    const abort = new AbortController();
    this.peakAbort = abort;
    this.peakKey = key;
    this.peakDataset = query.scaleKey ?? query.datasetKey;
    const request = { ...query.request, focusWindow: [], cutouts: null, underlay: null };
    delete request.focusStackIndex;
    void peak(request, abort.signal)
      .then((world) => {
        if (abort.signal.aborted || !this.active) return;
        if (entry.chosen) return void entry.done.add(kind);
        if (!world || !world.every(Number.isFinite)) return void entry.done.add(kind);
        const latest = this.snapshot.requested ?? query;
        const current = latest.request;
        // A changed dataset or view asks again on its next slice.
        if (
          (latest.scaleKey ?? latest.datasetKey) !== (query.scaleKey ?? query.datasetKey) ||
          current.orientation !== query.request.orientation
        )
          return;
        // Only the slice moves: keep wherever the crosshair is now in-plane.
        const axis = NORMAL_AXIS[current.orientation];
        const target = [...current.crosshairMm] as [number, number, number];
        target[axis] = world[axis];
        if (Math.abs(target[axis] - current.crosshairMm[axis]) <= CROSSHAIR_TOLERANCE_MM)
          return void entry.done.add(kind);
        // A refused move (another workspace) is retried on a later slice.
        if (this.navigator === navigator && navigator.navigate(target)) entry.done.add(kind);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        console.warn('[PopulationSliceService] Peak search failed:', error);
        entry.done.add(kind);
      })
      .finally(() => {
        if (this.peakAbort === abort) {
          this.peakAbort = null;
          this.peakKey = null;
          this.peakDataset = null;
        }
      });
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
    this.cancelPeak();
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
    if (this.peakDataset !== null && this.peakDataset !== (copy?.scaleKey ?? copy?.datasetKey))
      this.cancelPeak();
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
  /**
   * The scatter peek's raster: one context observation at a requested slice,
   * read through the focused-original path (`focusOnly`, so no summary is
   * reduced) of the displayed population request. Focus, the displayed result
   * and the colour scale are untouched. When the slice and orientation match
   * the displayed request the native plane cache serves it; otherwise the
   * native engine builds that plane, which replaces its single cached plane.
   */
  async evaluatePeek(
    target: {
      memberId: string;
      crosshairMm: readonly [number, number, number];
      orientation: PopulationOrientation;
    },
    signal: AbortSignal,
  ): Promise<PopulationPeekRaster> {
    const base = this.snapshot.displayed;
    if (!this.active || !base) throw new Error('No population slice is displayed yet.');
    const query = base.query;
    if (!query.request.members.some((m) => m.memberId === target.memberId))
      throw new Error(`${target.memberId} is not in the displayed population.`);
    const crosshairMm = [...target.crosshairMm] as [number, number, number];
    const sameView =
      query.request.orientation === target.orientation &&
      query.request.crosshairMm.every((v, i) => v === crosshairMm[i]);
    const contextKey = JSON.stringify([this.owner, query.datasetKey]);
    const request: PopulationSliceRequest = {
      ...query.request,
      contextKey,
      crosshairMm,
      orientation: target.orientation,
      focusOnly: true,
      focusWindow: [],
      focusMemberId: target.memberId,
      // Cutouts are part of the native plane key: keep them only where the
      // displayed plane can be reused.
      cutouts: sameView ? query.request.cutouts : null,
    };
    delete request.focusStackIndex;
    this.contexts.add(contextKey);
    const data = await this.dependencies.evaluate(request, signal);
    signal.throwIfAborted();
    const [w, h] = data.plane?.dim_px ?? [0, 0];
    const ids = query.request.members.map((m) => m.memberId);
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      h < 1 ||
      data.focused.length !== w * h ||
      data.focused.some((v) => v !== null && !Number.isFinite(v)) ||
      data.sources.length !== ids.length ||
      data.sources.some(
        (source, i) =>
          source.memberId !== ids[i] ||
          (query.request.members[i].expectedSha256 != null &&
            source.revision.sha256 !== query.request.members[i].expectedSha256),
      ) ||
      [...data.plane.origin_mm, ...data.plane.u_mm, ...data.plane.v_mm].some(
        (v) => !Number.isFinite(v),
      )
    )
      throw new Error('Peek raster does not match its observation or geometry.');
    return {
      memberId: target.memberId,
      crosshairMm,
      orientation: target.orientation,
      plane: data.plane,
      values: data.focused,
      revisionKey: populationRevisionKey(data.sources, data.maskRevision),
    };
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
        (this.snapshot.displayed?.query.request.focusMemberId !== query.request.focusMemberId ||
          this.snapshot.displayed?.query.request.focusStackIndex !== query.request.focusStackIndex);
      const reuse = !!focusChanged && this.samePopulation(base.query, query);
      const cached =
        reuse && query.request.focusStackIndex === undefined && Date.now() < this.focusExpires
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
        const focusWindow =
          query.request.focusStackIndex !== undefined
            ? []
            : [...ids.slice(Math.max(0, index - 1), Math.max(0, index - 1) + count)];
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
              underlay: base.data.underlay,
              underlayIssue: base.data.underlayIssue,
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
        // Window rasters share the returned plane, which the native side may
        // fit to square pixels at a size other than the requested one.
        const [planeW, planeH] = data.plane?.dim_px ?? [0, 0];
        if (
          window.length > count ||
          new Set(window.map((m) => m.memberId)).size !== window.length ||
          window.some(
            (m) =>
              !focusWindow.includes(m.memberId) ||
              m.values.length !== planeW * planeH,
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
            populationOverlayRgba(data.focused, base.effectLimit, true, {
              band: populationHiddenBand(base.effectLimit),
              underlay: base.underlay,
            }),
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
      // Display windows follow the data until set (by the user, a restore,
      // or a slice that holds data), then stay fixed across slices.
      const sharesEffect = populationSharesEffectScale(query.request);
      if (this.effectLimit === null)
        this.effectLimit = robustPopulationLimit(
          sharesEffect ? data.summary : data.focused,
          true,
        );
      const effectLimit = this.effectLimit ?? 1;
      const kind = populationDisplayKind(query.request);
      let summaryLimit = sharesEffect ? effectLimit : this.summaryLimits.get(kind);
      if (summaryLimit === undefined) {
        const channel = query.request.inference ? inferenceChannel(query.request.inference) : null;
        const count = channel?.countPopulation === 'B' ? data.reference?.unitCount : data.unitCount;
        const fixed =
          channel?.initialLimit ??
          (channel?.countPopulation || kind === 'coverage' ? count || 1 : undefined);
        const fitted =
          fixed ?? robustPopulationLimit(data.summary, populationDiverging(query.request));
        summaryLimit = fitted ?? 1;
        if (fitted !== null) this.summaryLimits.set(kind, summaryLimit);
      }
      const [w, h] = data.plane.dim_px;
      const underlayWindow = data.underlay ? populationUnderlayWindow(data.underlay.values) : undefined;
      const underlay = populationUnderlayGrey(data.underlay?.values, underlayWindow);
      const member = (values: readonly (number | null)[]) =>
        populationOverlayRgba(values, effectLimit, true, {
          band: populationHiddenBand(effectLimit),
          underlay,
        });
      const summary = await this.dependencies.bitmap(
        populationOverlayRgba(data.summary, summaryLimit, populationDiverging(query.request), {
          band: populationHiddenBand(summaryLimit, populationCountsSummary(query.request)),
          underlay,
        }),
        w,
        h,
      );
      let focused: ImageBitmap;
      try {
        focused = await this.dependencies.bitmap(member(data.focused), w, h);
      } catch (error) {
        summary.close();
        throw error;
      }
      let cutouts: ImageBitmap | null = null;
      const groups: Record<string, ImageBitmap> = Object.create(null);
      let reference: ImageBitmap | null = null;
      try {
        if (data.cutouts) {
          const packed = packPopulationCutouts(
            data.cutouts,
            effectLimit,
            populationUnderlayGrey(data.underlay?.cutouts, underlayWindow),
          );
          cutouts = await this.dependencies.bitmap(packed.rgba, packed.width, packed.height);
        }
        for (const group of data.groups ?? [])
          groups[group.id] = await this.dependencies.bitmap(member(group.values), w, h);
        if (data.reference)
          reference = await this.dependencies.bitmap(member(data.reference.values), w, h);
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
      this.focusBase = { query, data, images, effectLimit, summaryLimit, underlay };
      this.releaseBase = images.retain();
      this.publish({
        requested: query,
        displayed: this.focusBase,
        pending: false,
        error: null,
      });
      this.startPeak(query);
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

/** The source and mask revisions of a population result, as one comparable key. */
export function populationRevisionKey(
  sources: readonly { memberId: string; revision: { sha256: string } }[],
  maskRevision?: { sha256: string } | null,
): string {
  return JSON.stringify([sources.map((s) => [s.memberId, s.revision.sha256]), maskRevision?.sha256 ?? null]);
}

/** One observation's raster at a requested slice, for the scatter peek. */
export interface PopulationPeekRaster {
  memberId: string;
  crosshairMm: [number, number, number];
  orientation: PopulationOrientation;
  plane: ViewPlane;
  values: (number | null)[];
  /** Source and mask revisions the raster was read from (`populationRevisionKey`). */
  revisionKey: string;
}

export function populationAxisLabel(vector: readonly number[]) {
  const axis = vector.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(vector[best]) ? index : best),
    0,
  );
  return (vector[axis] >= 0 ? ['R', 'A', 'S'] : ['L', 'P', 'I'])[axis];
}

/** `worldMm` moved `distanceMm` along the plane normal, oriented towards the
 * positive end of its dominant world axis (+R, +A or +S). Null for a
 * degenerate plane. */
export function populationSliceStepPoint(
  plane: ViewPlane,
  worldMm: readonly [number, number, number],
  distanceMm: number,
): [number, number, number] | null {
  const u = plane.u_mm,
    v = plane.v_mm;
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...normal);
  if (!length) return null;
  const axis = normal.reduce(
    (best, value, index) => (Math.abs(value) > Math.abs(normal[best]) ? index : best),
    0,
  );
  const direction = normal[axis] < 0 ? -1 : 1;
  return worldMm.map(
    (value, axis) => value + (direction * distanceMm * normal[axis]) / length,
  ) as [number, number, number];
}

const userSliceListeners = new Set<(workspaceId: string) => void>();

export const populationSliceActions = {
  /** Slice moves the user makes in population views (not programmatic
   * moves), so an opening-slice jump never overrides the user's choice. */
  onUserSlice(listener: (workspaceId: string) => void) {
    userSliceListeners.add(listener);
    return () => {
      userSliceListeners.delete(listener);
    };
  },
  step(
    workspaceId: string,
    plane: ViewPlane,
    worldMm: [number, number, number],
    distanceMm: number,
  ) {
    const next = populationSliceStepPoint(plane, worldMm, distanceMm);
    if (next) this.navigate(workspaceId, next);
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
  /** A programmatic crosshair move; false when another workspace is active. */
  moveTo(workspaceId: string, worldMm: [number, number, number]) {
    const view = useViewStateStore.getState();
    if (view.activeWorkspaceKey !== workspaceId || !worldMm.every(Number.isFinite)) return false;
    // Synchronous canonical update avoids waiting for unrelated renderer resizes.
    view.setViewState((state) => {
      state.crosshair.world_mm = [...worldMm];
    }, workspaceId);
    return true;
  },
  navigate(workspaceId: string, worldMm: [number, number, number], pin = false) {
    if (!this.moveTo(workspaceId, worldMm)) return;
    userSliceListeners.forEach((listener) => listener(workspaceId));
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
    : ['mean', 'median'].includes(request.summary);
}

export function populationSharesEffectScale(request: PopulationSliceRequest) {
  return request.inference
    ? inferenceChannel(request.inference).scale === 'effect'
    : ['mean', 'median'].includes(request.summary);
}
