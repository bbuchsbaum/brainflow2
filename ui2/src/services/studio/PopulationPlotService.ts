import {
  samplePopulationTimeCourse,
  validatePopulationTrace,
  validateTraceDefinition,
  type PopulationTrace,
  type PopulationTimeAxis,
} from './PopulationTimeCourseService';
import { resolvePopulation } from './populationContext';
import { combinePopulationPlots } from './populationPlotCombine';
import { sampleProvider } from '@/services/SampleProvider';
import { buildPopulationSource } from './PopulationProbeController';
import { buildPopulationProbeQuery } from './PopulationProbeController';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SampleFrame } from '@/plotting';
import type { PopulationProbeResult } from './PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { populationProbeActions } from './PopulationProbeActions';
import {
  composePopulationPlot,
  defaultPopulationPlotRecipe,
  type PopulationPlotRecipe,
} from './populationPlot';
export interface PinnedPopulationPlot {
  featureId?: string;
  selectionBinding?: 'snapshot' | 'working';
  trace?: PopulationTrace;
  origins?: Pick<
    PinnedPopulationPlot,
    'id' | 'setId' | 'sessionRevision' | 'datasetKey' | 'query' | 'trace' | 'featureId'
  >[];
  id: string;
  label: string;
  datasetKey: string;
  setId: string;
  sessionRevision: number;
  frame: SampleFrame;
  recipe: PopulationPlotRecipe;
  query: PopulationProbeResult['query'];
}
function validateOrigins(p: PinnedPopulationPlot) {
  validatePopulationTrace(p);
  if (p.featureId !== undefined && typeof p.featureId !== 'string')
    throw new Error('Invalid plot feature identity.');
  if (p.selectionBinding !== undefined && !['snapshot', 'working'].includes(p.selectionBinding))
    throw new Error('Invalid plot selection binding.');
  if (
    p.origins !== undefined &&
    (!Array.isArray(p.origins) ||
      p.origins.length < 2 ||
      p.origins.length > 8 ||
      p.origins.some(
        (o) =>
          !o ||
          typeof o.id !== 'string' ||
          typeof o.setId !== 'string' ||
          (o.featureId !== undefined && typeof o.featureId !== 'string') ||
          !Number.isSafeInteger(o.sessionRevision) ||
          !o.query?.request,
      ) ||
      new Set(p.origins.map((o) => o.id)).size !== p.origins.length ||
      p.frame.rows.some(
        (r) =>
          !p.origins!.some((o) => o.id === r.__populationOrigin) ||
          typeof r.__populationObservation !== 'string',
      ))
  )
    throw new Error('Invalid combined plot provenance.');
  for (const origin of p.origins ?? []) if (origin.trace) validateTraceDefinition(origin.trace);
}
const MAX_BYTES = 16 * 1024 * 1024;
class PopulationPlotService {
  private state: readonly PinnedPopulationPlot[] = [];
  private listeners = new Set<() => void>();
  private linkIndexes = new WeakMap<
    PinnedPopulationPlot,
    Map<
      string,
      {
        memberId: string;
        frame: number | null;
        setId: string;
        revision: number;
        featureId?: string;
      }
    >
  >();
  private linkIndex(p: PinnedPopulationPlot) {
    let index = this.linkIndexes.get(p);
    if (index) return index;
    index = new Map();
    const origins = new Map((p.origins ?? [p]).map((o) => [o.id, o]));
    const traces = new Map(
      [...origins].map(([id, o]) => [id, new Map(o.trace?.samples.map((s) => [s.sampleId, s]))]),
    );
    for (const row of p.frame.rows) {
      const origin = p.origins ? origins.get(String(row.__populationOrigin)) : p;
      if (!origin) continue;
      const sampleId = String(p.origins ? row.__populationObservation : row.member);
      const trace = traces.get(origin.id)?.get(sampleId);
      index.set(String(row.member), {
        memberId: trace?.memberId ?? sampleId,
        frame: trace?.frame ?? null,
        setId: origin.setId,
        revision: origin.sessionRevision,
        featureId: origin.featureId,
      });
    }
    this.linkIndexes.set(p, index);
    return index;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(next: readonly PinnedPopulationPlot[]) {
    if (next.length > 8 || new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES)
      throw new Error(
        'Pinned plots exceed the eight-plot / 16 MiB sample budget. Close a plot first.',
      );
    this.state = next;
    this.listeners.forEach((f) => f());
  }
  pin(result: PopulationProbeResult, frame: SampleFrame) {
    const state = useSetStudioStore.getState();
    const current = buildPopulationProbeQuery(
      state,
      useViewStateStore.getState().activeWorkspaceKey,
    );
    if (current.query?.key !== result.query.key)
      throw new Error('The population sample changed. Wait for the current sample before pinning.');
    composePopulationPlot(frame, defaultPopulationPlotRecipe);
    const feature = state.features[state.selection.activeFeatureId ?? ''];
    const plot: PinnedPopulationPlot = structuredClone({
      id: crypto.randomUUID(),
      label: `${state.sets[state.selection.activeSetId!]?.name ?? 'Population'} · ${feature?.label ?? 'Values'} · ${result.query.probe.worldMm.map((v) => v.toFixed(1)).join(', ')}`,
      datasetKey: result.query.datasetKey,
      setId: state.selection.activeSetId!,
      featureId: state.selection.activeFeatureId ?? undefined,
      sessionRevision: state.population.sessionRevision,
      frame: feature?.units
        ? {
            ...frame,
            columns: frame.columns.map((c) =>
              c.name === 'value' ? { ...c, unit: feature.units } : c,
            ),
          }
        : frame,
      recipe: defaultPopulationPlotRecipe,
      query: result.query,
    });
    this.publish([...this.state, plot]);
    usePlotModeStore.getState().setActivePlotMode('population');
    const layout = useLayoutSettingsStore.getState();
    layout.setBottomDockOpen(true);
    layout.setBottomDockMinimized(false);
    layout.setBottomDockActiveTab('plot');
    return plot.id;
  }
  async timeCourse(id: string, axis: PopulationTimeAxis, signal: AbortSignal) {
    const plot = this.state.find((p) => p.id === id);
    if (!plot || !this.canLink(plot))
      throw new Error('Link an original probe to the current population first.');
    const workspace = useViewStateStore.getState().activeWorkspaceKey;
    const result = await samplePopulationTimeCourse(plot, axis, signal);
    signal.throwIfAborted();
    if (
      !this.canLink(plot) ||
      this.state.find((p) => p.id === id) !== plot ||
      workspace !== useViewStateStore.getState().activeWorkspaceKey
    )
      throw new Error('The plot or destination changed while sampling time courses.');
    const next = {
      ...structuredClone(plot),
      ...result,
      id: crypto.randomUUID(),
      label: `${plot.label} · time courses`,
    };
    this.publish([...this.state, next]);
    return next.id;
  }
  combine(ids: string[]) {
    const selected = ids.map((id) => {
      const p = this.state.find((p) => p.id === id);
      if (!p) throw new Error('A selected plot is no longer available.');
      return p;
    });
    if (new Set(ids).size !== ids.length) throw new Error('Choose distinct plots.');
    const frame = combinePopulationPlots(selected);
    const id = crypto.randomUUID();
    this.publish([
      ...this.state,
      {
        ...structuredClone(selected[0]),
        id,
        label: `Combined · ${selected.length} pinned probes`,
        trace: undefined,
        frame,
        origins: selected.map(
          ({ id, setId, sessionRevision, datasetKey, query, trace, featureId }) => ({
            id,
            setId,
            sessionRevision,
            datasetKey,
            query,
            trace,
            featureId,
          }),
        ),
        recipe: {
          ...defaultPopulationPlotRecipe,
          x: '__populationObservation',
          facet: '__populationProbe',
        },
      },
    ]);
    return id;
  }
  /** Re-sample with frozen digests at the saved probe before enabling live links.
   * Matching filenames or IDs alone never authorizes a saved point's link. */
  async verifyAndLink(id: string, signal: AbortSignal) {
    const plot = this.state.find((p) => p.id === id);
    if (!plot || plot.origins)
      throw new Error('Verify original plots individually before combining.');
    const s = useSetStudioStore.getState();
    const workspace = useViewStateStore.getState().activeWorkspaceKey;
    const source = buildPopulationSource(s, workspace).source;
    const locus = plot.query.request?.locus;
    if (!source || locus?.kind !== 'set')
      throw new Error('Load the matching population before linking this plot.');
    const traceById = new Map(plot.trace?.samples.map((s) => [s.sampleId, s]));
    const sourceById = new Map(source.members.map((m) => [m.memberId, m]));
    const identityById = new Map(plot.frame.meta?.sources?.map((m) => [m.memberId, m]));
    const members = locus.members.map((saved) => {
      const trace = traceById.get(saved.memberId);
      const current = sourceById.get(trace?.memberId ?? saved.memberId);
      const identity = identityById.get(saved.memberId);
      if (
        !current ||
        !identity?.sourceRevision?.sha256 ||
        identity.error ||
        (trace?.frame ?? current.stackIndex ?? null) !== identity.stackIndex
      )
        throw new Error('Saved observations and frames do not match the current population.');
      return {
        ...saved,
        sourcePath: current.sourcePath,
        memberId: saved.memberId,
        ...(trace ? { stackIndex: trace.frame } : {}),
        expectedSha256: identity.sourceRevision.sha256,
      };
    });
    const masks = new Set(plot.frame.meta?.sources?.map((m) => m.maskRevision?.sha256 ?? null));
    if (masks.size !== 1 || !!locus.mask !== !!source.mask || (locus.mask && ![...masks][0]))
      throw new Error(
        'Saved probe mask identity is incomplete or differs from the current population.',
      );
    const request = {
      ...plot.query.request,
      datasetId: s.selection.activeSetId!,
      locus: {
        ...locus,
        members,
        ...(source.mask ? { mask: { ...source.mask, expectedSha256: [...masks][0]! } } : {}),
      },
    };
    const rows: SampleFrame['rows'][number][] = [];
    const proofs: NonNullable<NonNullable<SampleFrame['meta']>['sources']>[number][] = [];
    for (let offset = 0; offset < members.length; offset += 128) {
      signal.throwIfAborted();
      const chunk = await sampleProvider.sample(
        { ...request, locus: { ...request.locus, members: members.slice(offset, offset + 128) } },
        signal,
      );
      rows.push(...chunk.rows);
      proofs.push(...(chunk.meta?.sources ?? []));
    }
    const sampled = { rows, meta: { sources: proofs } };
    const memberById = new Map(members.map((m) => [m.memberId, m]));
    const rowById = new Map(plot.frame.rows.map((r) => [r.member, r]));
    signal.throwIfAborted();
    const now = useSetStudioStore.getState();
    if (
      now.population.sessionRevision !== s.population.sessionRevision ||
      now.selection.activeSetId !== s.selection.activeSetId ||
      now.selection.activeFeatureId !== s.selection.activeFeatureId ||
      workspace !== useViewStateStore.getState().activeWorkspaceKey ||
      this.state.find((p) => p.id === id) !== plot
    )
      throw new Error('The destination or saved plot changed while verifying.');
    if (
      sampled.meta?.sources?.length !== members.length ||
      new Set(sampled.meta?.sources?.map((s) => s.memberId)).size !== members.length ||
      new Set(sampled.rows.map((r) => r.member)).size !== members.length ||
      sampled.meta.sources.some(
        (s) =>
          s.error ||
          s.stackIndex !== (memberById.get(s.memberId)?.stackIndex ?? null) ||
          (s.maskRevision?.sha256 ?? null) !== ([...masks][0] ?? null) ||
          s.sourceRevision?.sha256 !== memberById.get(s.memberId)?.expectedSha256,
      )
    )
      throw new Error('The saved source snapshots could not be verified.');
    if (
      sampled.rows.length !== plot.frame.rows.length ||
      sampled.rows.some((r) => {
        const original = rowById.get(r.member);
        return !original || !Object.is(original.value, r.value);
      })
    )
      throw new Error('Re-sampled values differ from this receipt; it remains detached.');
    this.publish(
      this.state.map((p) =>
        p.id === id
          ? {
              ...p,
              setId: s.selection.activeSetId!,
              featureId: s.selection.activeFeatureId ?? undefined,
              sessionRevision: s.population.sessionRevision,
              datasetKey: source.datasetKey,
              query: { ...p.query, request },
            }
          : p,
      ),
    );
  }
  bindSelection(id: string, binding: 'snapshot' | 'working') {
    const plot = this.state.find((p) => p.id === id);
    if (!plot) return;
    if (binding === 'working' && !this.canLink(plot))
      throw new Error('Verify live image links before following a selection.');
    if ((plot.selectionBinding ?? 'snapshot') !== binding)
      this.publish(this.state.map((p) => (p.id === id ? { ...p, selectionBinding: binding } : p)));
  }
  frameForView(p: PinnedPopulationPlot): SampleFrame | null {
    if (p.selectionBinding !== 'working') return p.frame;
    if (!this.canLink(p)) return null;
    const selected = new Set(resolvePopulation(useSetStudioStore.getState()).workingMemberIds);
    return {
      ...p.frame,
      rows: p.frame.rows.filter((row) => {
        const member = this.linkedMember(p, String(row.member));
        return member !== null && selected.has(member);
      }),
    };
  }
  configure(id: string, recipe: PopulationPlotRecipe) {
    const p = this.state.find((p) => p.id === id);
    if (!p) return;
    composePopulationPlot(p.frame, recipe);
    this.publish(
      this.state.map((p) => (p.id === id ? { ...p, recipe: structuredClone(recipe) } : p)),
    );
  }
  close(id: string) {
    this.publish(this.state.filter((p) => p.id !== id));
  }
  canLink(p: PinnedPopulationPlot) {
    const s = useSetStudioStore.getState();
    return (p.origins ?? [p]).some(
      (origin) =>
        origin.setId === s.selection.activeSetId &&
        origin.featureId === s.selection.activeFeatureId &&
        origin.sessionRevision === s.population.sessionRevision,
    );
  }
  linkedMember(p: PinnedPopulationPlot, id: string): string | null {
    const link = this.linkIndex(p).get(id),
      state = useSetStudioStore.getState();
    return link?.setId === state.selection.activeSetId &&
      link?.featureId === state.selection.activeFeatureId &&
      link?.revision === state.population.sessionRevision
      ? link.memberId
      : null;
  }
  linkedFrame(p: PinnedPopulationPlot, id: string): number | null {
    return this.linkIndex(p).get(id)?.frame ?? null;
  }
  focus(p: PinnedPopulationPlot, id: string) {
    const member = this.linkedMember(p, id);
    if (member !== null) {
      const frame = this.linkedFrame(p, id);
      if (frame !== null) useSetStudioStore.getState().setPopulationFocusedFrame(member, frame);
      else populationProbeActions.focus(member);
    }
  }
  select(p: PinnedPopulationPlot, id: string) {
    const member = this.linkedMember(p, id);
    if (member !== null) populationProbeActions.toggle(member);
  }
  savedFor(datasetKey: string) {
    const plots = this.state.filter((p) => p.datasetKey === datasetKey && this.canLink(p));
    if (!plots.length) return undefined;
    const result = { version: 1, plots: structuredClone(plots) };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024)
      throw new Error(
        'Pinned plot samples exceed the 512 KiB study allowance. Save larger plots separately, then close them before freezing.',
      );
    return result;
  }
  prepareSaved(value: unknown): PinnedPopulationPlot[] {
    if (value === undefined || value === null) return [];
    const raw = value as { version: number; plots: PinnedPopulationPlot[] };
    if (
      raw.version !== 1 ||
      !Array.isArray(raw.plots) ||
      raw.plots.length > 8 ||
      new TextEncoder().encode(JSON.stringify(raw)).length > 512 * 1024
    )
      throw new Error('Invalid saved population plots.');
    const next = raw.plots.map((p) => {
      if (typeof p.label !== 'string' || !p.query?.probe || !p.recipe)
        throw new Error('Incomplete saved plot provenance.');
      composePopulationPlot(p.frame, p.recipe);
      validateOrigins(p);
      return {
        ...structuredClone(p),
        id: crypto.randomUUID(),
        sessionRevision: -1,
        ...(p.origins ? { origins: p.origins.map((o) => ({ ...o, sessionRevision: -1 })) } : {}),
      };
    });
    if (
      this.state.length + next.length > 8 ||
      new TextEncoder().encode(JSON.stringify([...this.state, ...next])).length > MAX_BYTES
    )
      throw new Error(
        'Close pinned plots before opening this study; its samples exceed the plot cache budget.',
      );
    return next;
  }
  restoreSaved(plots: PinnedPopulationPlot[]) {
    if (plots.length) this.publish([...this.state, ...plots]);
  }
  serialize(id: string) {
    const p = this.state.find((p) => p.id === id);
    if (!p) throw new Error('Plot unavailable.');
    return JSON.stringify({ schema: 'brainflow.population-plot.v1', plot: p }, null, 2);
  }
  reopen(text: string) {
    if (new TextEncoder().encode(text).length > MAX_BYTES)
      throw new Error('Plot file exceeds 16 MiB.');
    const raw = JSON.parse(text);
    if (
      raw.schema !== 'brainflow.population-plot.v1' ||
      !raw.plot ||
      !Array.isArray(raw.plot.frame?.rows) ||
      !Array.isArray(raw.plot.frame?.columns)
    )
      throw new Error('Unsupported population plot file.');
    const p = raw.plot as PinnedPopulationPlot;
    if (typeof p.label !== 'string' || !p.query?.probe || !p.recipe)
      throw new Error('Incomplete plot provenance.');
    composePopulationPlot(p.frame, p.recipe);
    validateOrigins(p);
    // Portable sample receipts reopen detached: matching strings do not prove live identity.
    this.publish([
      ...this.state,
      {
        ...p,
        id: crypto.randomUUID(),
        sessionRevision: -1,
        ...(p.origins ? { origins: p.origins.map((o) => ({ ...o, sessionRevision: -1 })) } : {}),
      },
    ]);
  }
}
export const populationPlotService = new PopulationPlotService();
