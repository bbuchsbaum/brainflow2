import { studioMetadata } from './studioMetadata';
import {
  arrangePopulationResponses,
  populationBindingKey,
  type PopulationArrangement,
} from './populationWitnesses';
import { formatTauriError } from '@/utils/formatTauriError';
import { sampleProvider } from '@/services/SampleProvider';
import { resolvePopulationContext } from './populationContext';
import { setImportReadiness } from './importContract';
import type { SampleFrame, SampleRequest } from '@/plotting';
import type { PopulationProbe, PopulationState } from '@/types/population';
import type { PopulationContextHost } from './populationContext';

export interface PopulationProbeQuery {
  readonly key: string;
  readonly datasetKey: string;
  readonly probe: PopulationProbe;
  readonly request: SampleRequest;
}
export interface PopulationProbeResult {
  readonly query: PopulationProbeQuery;
  readonly frame: SampleFrame;
}
export interface PopulationProbeSnapshot {
  readonly arrangement: PopulationArrangement | null;
  readonly requested: PopulationProbeQuery | null;
  readonly displayed: PopulationProbeResult | null;
  readonly pending: boolean;
  readonly error: string | null;
}

/** Descriptive distribution of finite, selected per-observation probe values.
 * Spatial reduction has already occurred in the sampler. Sign shares use these
 * observed responses, with an inclusive near-zero interval in their units. */
export function describePopulationProbe(
  frame: SampleFrame | undefined,
  selected: ReadonlySet<string>,
  nearZeroLimit = 0,
) {
  if (!Number.isFinite(nearZeroLimit) || nearZeroLimit < 0)
    throw new Error('The near-zero limit must be finite and nonnegative.');
  let count = 0,
    mean = 0,
    meanAbsolute = 0,
    unavailable = 0,
    selectedMissing = 0;
  let positive = 0,
    negative = 0,
    nearZero = 0;
  for (const row of frame?.rows ?? []) {
    const isSelected = selected.has(String(row.member));
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      unavailable++;
      if (isSelected) selectedMissing++;
      continue;
    }
    if (!isSelected) continue;
    const value = row.value;
    count++;
    // A difference of opposite finite signs can overflow double precision.
    // Same-sign differences remain bounded; opposite signs use weighted terms.
    mean =
      mean < 0 !== value < 0
        ? mean * ((count - 1) / count) + value / count
        : mean + (value - mean) / count;
    meanAbsolute += (Math.abs(value) - meanAbsolute) / count;
    if (value > nearZeroLimit) positive++;
    else if (value < -nearZeroLimit) negative++;
    else nearZero++;
  }
  return {
    mean: count ? mean : null,
    meanAbsolute: count ? meanAbsolute : null,
    cancellation: count ? Math.max(0, meanAbsolute - Math.abs(mean)) : null,
    count,
    unavailable,
    selectedMissing,
    positive,
    negative,
    nearZero,
  };
}

/** Compatibility shape for existing callers of the selected mean readout. */
export function summarizePopulationProbe(
  frame: SampleFrame | undefined,
  selected: ReadonlySet<string>,
) {
  const { mean, count, unavailable } = describePopulationProbe(frame, selected);
  return { mean, count, unavailable };
}

/** Pure query definition. Focus, working selection, reference and presentation
 * order are deliberately absent: all context observations are sampled once. */
export function buildPopulationProbeQuery(
  state: PopulationContextHost & { readonly population: PopulationState },
  workspaceId: string,
): { query: PopulationProbeQuery | null; issue: string | null } {
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  const probe = state.population.pinnedProbe ?? state.population.hoverProbe;
  if (!set || !probe) return { query: null, issue: null };
  const resolved = buildPopulationSource(state, workspaceId);
  if (!resolved.source) return { query: null, issue: resolved.issue };
  const expectedSupport = populationSupportKey(state, workspaceId);
  if (probe.supportKey !== expectedSupport)
    return {
      query: null,
      issue:
        'This probe belongs to another dataset or workspace. Pin a location in the current view.',
    };
  const { datasetKey, members } = resolved.source;
  const metadata = studioMetadata(
    set,
    members.map((member) => member.memberId),
  );
  const labeledMembers = metadata.issue
    ? members
    : members.map((member) => ({
        ...member,
        designValues: metadata.columns.map((column) => ({
          column,
          value: metadata.rows.get(member.memberId)![column],
        })),
      }));
  const request: SampleRequest = {
    datasetId: set.id,
    reduce: probe.reduce,
    locus: {
      kind: 'set',
      members: labeledMembers,
      worldMm: [...probe.worldMm],
      radiusMm: probe.radiusMm,
    },
  };
  const key = JSON.stringify([datasetKey, probe.supportKey, request]);
  return { query: { key, datasetKey, probe, request }, issue: null };
}

/** Shared audited source binding for plots and live population fields. */
export function buildPopulationSource(
  state: PopulationContextHost & { readonly population: PopulationState },
  workspaceId: string,
) {
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  if (!set) return { source: null, issue: null };
  const context = resolvePopulationContext(state);
  if (context.issue) return { source: null, issue: context.issue };
  if (set.supportKind !== 'volume' || setImportReadiness(set) !== 'compare_ready') {
    return {
      source: null,
      issue: 'Population probes require volume observations with an audited common support.',
    };
  }
  const members: { memberId: string; sourcePath: string }[] = [];
  for (const id of context.memberIds) {
    const summaries = set.memberSummaries.filter((candidate) => candidate.id === id);
    if (summaries.length !== 1)
      return { source: null, issue: `Observation ${id} requires exactly one source record.` };
    const member = summaries[0];
    const bindings =
      member?.bindings?.filter(
        (binding) =>
          binding.featureId === state.selection.activeFeatureId ||
          (state.selection.activeFeatureId === set.primaryFeatureId &&
            binding.isPrimary &&
            binding.featureId === null),
      ) ?? [];
    if (
      bindings.length > 1 ||
      bindings.some(
        (binding) =>
          binding.availability !== 'available' ||
          binding.selector ||
          binding.supportKind !== 'volume',
      )
    ) {
      return {
        source: null,
        issue: `Observation ${id} has an ambiguous, unavailable or frame-selected feature. Resolve its source before probing.`,
      };
    }
    const sourcePath =
      bindings.length === 1
        ? bindings[0].sourcePath
        : state.selection.activeFeatureId === set.primaryFeatureId
          ? member?.sourcePath
          : null;
    if (!sourcePath?.trim())
      return { source: null, issue: `Observation ${id} has no source for the selected feature.` };
    members.push({ memberId: id, sourcePath });
  }
  const datasetKey = JSON.stringify([
    workspaceId,
    state.population.sessionRevision,
    set.id,
    state.selection.activeFeatureId,
  ]);
  return { source: { datasetKey, setId: set.id, members }, issue: null };
}

export function populationSupportKey(
  state: PopulationContextHost & { readonly population: PopulationState },
  workspaceId: string,
): string {
  // Identity of the audited import's support, not a guess from a template label.
  return JSON.stringify([
    workspaceId,
    state.population.sessionRevision,
    state.selection.activeSetId,
  ]);
}

/** One active sampling call plus the latest pending query. Obsolete results are
 * discarded independently of transport completion. Stopping or replacing the query
 * aborts native sampling through SampleProvider; native workers keep ownership
 * until a cooperative cancellation boundary is reached. */
export class PopulationProbeController {
  private snapshot: PopulationProbeSnapshot = {
    arrangement: null,
    requested: null,
    displayed: null,
    pending: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private active = true;
  private busy = false;
  private activeAbort: AbortController | null = null;
  private pending: PopulationProbeQuery | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly sample: (request: SampleRequest, signal?: AbortSignal) => Promise<SampleFrame>;
  private readonly delayMs: number;
  constructor(
    sample: (request: SampleRequest, signal?: AbortSignal) => Promise<SampleFrame> = (
      request,
      signal,
    ) => sampleProvider.sample(request, signal),
    delayMs = 40,
  ) {
    this.sample = sample;
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
    this.activeAbort?.abort();
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.publish({
      arrangement: null,
      requested: null,
      displayed: null,
      pending: false,
      error: null,
    });
  }
  request(query: PopulationProbeQuery | null, force = false) {
    if (!this.active || (!force && query?.key === this.snapshot.requested?.key)) return;
    this.generation++;
    this.activeAbort?.abort();
    this.pending = query ? structuredClone(query) : null;
    const keep =
      query && this.snapshot.displayed?.query.datasetKey === query.datasetKey
        ? this.snapshot.displayed
        : null;
    const arrangement = this.snapshot.arrangement;
    this.publish({
      arrangement:
        !query ||
        (arrangement && populationBindingKey(arrangement.query) === populationBindingKey(query))
          ? arrangement
          : null,
      requested: this.pending,
      displayed: keep,
      pending: !!query,
      error: null,
    });
    if (!query) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    } else this.schedule();
  }
  arrange(mode: PopulationArrangement['mode']) {
    const { displayed, requested, pending, error } = this.snapshot;
    if (!displayed || displayed.query.key !== requested?.key || pending || error) return false;
    this.publish({ ...this.snapshot, arrangement: arrangePopulationResponses(displayed, mode) });
    return true;
  }
  expandWitnesses() {
    const arrangement = this.snapshot.arrangement;
    if (arrangement?.mode === 'witnesses')
      this.publish({ ...this.snapshot, arrangement: { ...arrangement, mode: 'all' } });
  }
  clearArrangement() {
    if (this.snapshot.arrangement) this.publish({ ...this.snapshot, arrangement: null });
  }
  private publish(snapshot: PopulationProbeSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  private schedule() {
    if (this.busy || this.timer !== null || !this.active || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }
  private async run() {
    if (this.busy || !this.active || !this.pending) return;
    const query = this.pending;
    const generation = this.generation;
    this.pending = null;
    this.busy = true;
    const abort = new AbortController();
    this.activeAbort = abort;
    try {
      const frame = await this.sample(query.request, abort.signal);
      if (!this.active || generation !== this.generation) return;
      const members = query.request.locus.kind === 'set' ? query.request.locus.members : [];
      const expected = new Set(members.map((member) => member.memberId));
      const actual = frame.rows.map((row) => row.member);
      if (
        actual.length !== expected.size ||
        new Set(actual).size !== actual.length ||
        actual.some((id) => typeof id !== 'string' || !expected.has(id))
      ) {
        throw new Error('The sampled observations do not match this population query.');
      }
      this.publish({
        arrangement: this.snapshot.arrangement,
        requested: query,
        displayed: { query, frame },
        pending: false,
        error: null,
      });
    } catch (error) {
      if (this.active && generation === this.generation)
        this.publish({
          ...this.snapshot,
          pending: false,
          error: formatTauriError(error),
        });
    } finally {
      if (this.activeAbort === abort) this.activeAbort = null;
      this.busy = false;
      this.schedule();
    }
  }
}
