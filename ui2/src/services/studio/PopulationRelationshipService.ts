import type { ViewPlane } from '@/types/coordinates';
import { populationRgba } from './PopulationSliceService';
import { populationProbeActions } from './PopulationProbeActions';
import { resolvePopulation } from './populationContext';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { buildPopulationSource } from './PopulationProbeController';
import { invokeCancelable } from './PopulationExportService';
import { formatTauriError } from '@/utils/formatTauriError';
import type {
  PopulationMask,
  PopulationMemberSource,
  PopulationPartition,
} from '@/types/population';
export interface RelationshipRequest {
  members: PopulationMemberSource[];
  mask: PopulationMask | null;
  region: { worldMm: [number, number, number]; radiusMm: number } | null;
  distance: 'effect' | 'pattern-shape';
}
export interface RelationshipFit {
  fitId: string;
  request: RelationshipRequest;
  supportSha256: string;
  candidateVoxels: number;
  commonVoxels: number;
  finiteCounts: number[];
  dimensions: number[];
  affine: number[][];
  geometry: {
    coordinates: [number, number][];
    componentScores?: number[][];
    distances: number[][];
    eigenvalues: number[];
    explainedFraction: number;
    stress: number;
    orderable: boolean;
    merges: { left: number; right: number; distance: number; count: number }[];
  };
}
interface Snapshot {
  fit: RelationshipFit | null;
  scope: string | null;
  pending: boolean;
  error: string | null;
  stale: boolean;
}
const empty: Snapshot = { fit: null, scope: null, pending: false, error: null, stale: false };
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export function sameRelationshipBindings(
  a: RelationshipRequest,
  b: Pick<RelationshipRequest, 'members' | 'mask'>,
  frozen = false,
): boolean {
  return (
    a.members.length === b.members.length &&
    a.members.every((member, i) => {
      const other = b.members[i];
      return (
        other?.memberId === member.memberId &&
        (frozen
          ? hash(other.expectedSha256) && member.expectedSha256 === other.expectedSha256
          : other.sourcePath === member.sourcePath) &&
        (other.stackIndex ?? null) === (member.stackIndex ?? null) &&
        (!(frozen || other.expectedSha256) || member.expectedSha256 === other.expectedSha256)
      );
    }) &&
    (frozen
      ? !!a.mask === !!b.mask && (!a.mask || hash(b.mask?.expectedSha256))
      : (a.mask?.sourcePath ?? null) === (b.mask?.sourcePath ?? null)) &&
    (!(frozen || b.mask?.expectedSha256) ||
      (a.mask?.expectedSha256 ?? null) === (b.mask?.expectedSha256 ?? null))
  );
}
/** Validate transport and saved-fit geometry before it can drive identity/order. */
export function validRelationshipFit(value: unknown): value is RelationshipFit {
  try {
    const f = value as RelationshipFit,
      n = f.request.members.length,
      g = f.geometry;
    if (
      n < 2 ||
      n > 128 ||
      !hash(f.fitId) ||
      !hash(f.supportSha256) ||
      !['effect', 'pattern-shape'].includes(f.request.distance) ||
      new Set(f.request.members.map((m) => m.memberId)).size !== n ||
      f.request.members.some((m) => !m.memberId || !m.sourcePath || !hash(m.expectedSha256)) ||
      (f.request.mask && !hash(f.request.mask.expectedSha256))
    )
      return false;
    if (
      f.request.region &&
      (!Number.isFinite(f.request.region.radiusMm) ||
        f.request.region.radiusMm <= 0 ||
        f.request.region.radiusMm > 200 ||
        f.request.region.worldMm.length !== 3 ||
        !f.request.region.worldMm.every(Number.isFinite))
    )
      return false;
    if (
      !Number.isSafeInteger(f.candidateVoxels) ||
      !Number.isSafeInteger(f.commonVoxels) ||
      f.commonVoxels < 2 ||
      f.commonVoxels > f.candidateVoxels ||
      f.finiteCounts.length !== n ||
      f.finiteCounts.some(
        (c) => !Number.isSafeInteger(c) || c < f.commonVoxels || c > f.candidateVoxels,
      )
    )
      return false;
    if (
      (g.componentScores !== undefined &&
        (g.componentScores.length !== n ||
          g.componentScores.some(
            (row) =>
              !Array.isArray(row) ||
              row.length > 8 ||
              row.length !== g.componentScores![0].length ||
              !row.every(Number.isFinite),
          ))) ||
      g.coordinates.length !== n ||
      g.coordinates.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
      g.distances.length !== n ||
      g.distances.some(
        (row, i) =>
          row.length !== n ||
          row.some(
            (v, j) =>
              !Number.isFinite(v) ||
              v < 0 ||
              Math.abs(v - (g.distances[j]?.[i] ?? NaN)) > 1e-8 * Math.max(1, v),
          ) ||
          Math.abs(row[i]) > 1e-8,
      )
    )
      return false;
    if (
      g.eigenvalues.length !== n ||
      g.eigenvalues.some((v) => !Number.isFinite(v) || v < 0) ||
      !Number.isFinite(g.stress) ||
      g.stress < 0 ||
      !Number.isFinite(g.explainedFraction) ||
      g.explainedFraction < 0 ||
      g.explainedFraction > 1 + 1e-8 ||
      typeof g.orderable !== 'boolean' ||
      g.merges.length !== n - 1
    )
      return false;
    if (
      g.orderable &&
      (g.eigenvalues[0] <= 0 ||
        g.eigenvalues[0] - g.eigenvalues[1] <= g.eigenvalues[0] * 1e-8 ||
        !g.coordinates.some((point) => point[0] !== 0))
    )
      return false;
    if (
      f.dimensions.length !== 3 ||
      f.dimensions.some((d) => !Number.isSafeInteger(d) || d < 1) ||
      f.affine.length !== 4 ||
      f.affine.some((row) => row.length !== 4 || !row.every(Number.isFinite))
    )
      return false;
    const active = new Map(Array.from({ length: n }, (_, i) => [i, 1]));
    for (let i = 0; i < g.merges.length; i++) {
      const m = g.merges[i];
      if (
        m.left === m.right ||
        !active.has(m.left) ||
        !active.has(m.right) ||
        m.count !== active.get(m.left)! + active.get(m.right)! ||
        !Number.isFinite(m.distance) ||
        m.distance < 0
      )
        return false;
      active.delete(m.left);
      active.delete(m.right);
      active.set(n + i, m.count);
    }
    return true;
  } catch {
    return false;
  }
}
export function relationshipPartition(
  fit: RelationshipFit,
  count: number,
  setId: string,
): PopulationPartition {
  const ids = fit.request.members.map((m) => m.memberId),
    n = ids.length;
  if (!validRelationshipFit(fit) || !Number.isInteger(count) || count < 2 || count > n)
    throw new Error('Choose between two groups and the observation count.');
  const groups = new Map(ids.map((id, i) => [i, [id]]));
  fit.geometry.merges.slice(0, n - count).forEach((merge, i) => {
    groups.set(n + i, [...groups.get(merge.left)!, ...groups.get(merge.right)!]);
    groups.delete(merge.left);
    groups.delete(merge.right);
  });
  return {
    setId,
    column: 'Spatial similarity',
    origin: 'map-derived',
    fitId: fit.fitId,
    contextIds: ids,
    groups: [...groups.values()]
      .sort(
        (a, b) =>
          Math.min(...a.map((id) => ids.indexOf(id))) - Math.min(...b.map((id) => ids.indexOf(id))),
      )
      .map((members, i) => ({
        id: `similarity-${i}`,
        label: `Similarity group ${i + 1}`,
        value: String(i + 1),
        memberIds: ids.filter((id) => members.includes(id)),
      })),
  };
}
export function relationshipSource() {
  const state = useSetStudioStore.getState(),
    workspace = useViewStateStore.getState().activeWorkspaceKey;
  const resolved = buildPopulationSource(state, workspace);
  return {
    ...resolved,
    scope: resolved.source
      ? JSON.stringify([
          resolved.source.datasetKey,
          resolved.source.members,
          resolved.source.mask ?? null,
        ])
      : null,
  };
}
export class PopulationRelationshipService {
  // At most the current plot and the fit that produced the retained movie order.
  private orderFit: RelationshipFit | null = null;
  private snapshot: Snapshot = empty;
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort: AbortController | null = null;
  private evaluate: (request: RelationshipRequest, signal: AbortSignal) => Promise<RelationshipFit>;
  constructor(
    evaluate = (request: RelationshipRequest, signal: AbortSignal) =>
      invokeCancelable<RelationshipFit>('fit_population_relationship', { request }, signal),
  ) {
    this.evaluate = evaluate;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Snapshot) {
    this.snapshot = value;
    this.listeners.forEach((l) => l());
  }
  cancel = () => {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    if (this.snapshot.pending) this.publish({ ...this.snapshot, pending: false });
  };
  resetScope(scope: string | null) {
    if (this.snapshot.scope === scope) return;
    this.cancel();
    this.orderFit = null;
    this.publish({ ...empty, scope });
  }
  async fit(distance: RelationshipRequest['distance'], regional = false) {
    const { source, issue, scope } = relationshipSource();
    if (!source) {
      this.publish({ ...this.snapshot, error: issue ?? 'Load an eligible population.' });
      return;
    }
    const state = useSetStudioStore.getState(),
      probe = state.population.pinnedProbe;
    if (regional && (!probe || probe.radiusMm <= 0)) {
      this.publish({
        ...this.snapshot,
        error: 'Pin a region with a positive radius before fitting within it.',
      });
      return;
    }
    this.resetScope(scope);
    this.cancel();
    const generation = this.generation,
      abort = new AbortController();
    this.abort = abort;
    const request: RelationshipRequest = {
      members: source.members,
      mask: source.mask ?? null,
      region: regional ? { worldMm: [...probe!.worldMm], radiusMm: probe!.radiusMm } : null,
      distance,
    };
    this.publish({ ...this.snapshot, pending: true, error: null });
    try {
      const fit = await this.evaluate(request, abort.signal);
      if (
        abort.signal.aborted ||
        generation !== this.generation ||
        relationshipSource().scope !== scope
      )
        return;
      if (
        !validRelationshipFit(fit) ||
        !sameRelationshipBindings(fit.request, request) ||
        JSON.stringify(fit.request.region) !== JSON.stringify(request.region) ||
        fit.request.distance !== request.distance
      )
        throw new Error('Similarity result does not match the requested context/support.');
      this.install(fit, scope!);
    } catch (error) {
      if (!abort.signal.aborted && generation === this.generation)
        this.publish({ ...this.snapshot, pending: false, error: formatTauriError(error) });
    }
  }
  private install(fit: RelationshipFit, scope: string) {
    const state = useSetStudioStore.getState();
    const result = state.setPopulationRelationship({
      fitId: fit.fitId,
      sessionRevision: state.population.sessionRevision,
      featureId: state.selection.activeFeatureId!,
      supportKey: fit.supportSha256,
      contextMemberIds: fit.request.members.map((m) => m.memberId),
      distance: fit.request.distance,
    });
    if (!result.ok) throw new Error(result.reason);
    this.publish({ fit: structuredClone(fit), scope, pending: false, error: null, stale: false });
  }
  observeSources(sources: { memberId: string; revision: { sha256: string } }[], maskSha?: string) {
    const fit = this.snapshot.fit;
    if (!fit || this.snapshot.stale) return;
    if (
      fit.request.members.some(
        (m) => sources.find((s) => s.memberId === m.memberId)?.revision.sha256 !== m.expectedSha256,
      ) ||
      (fit.request.mask?.expectedSha256 ?? null) !== (maskSha ?? null)
    )
      this.publish({ ...this.snapshot, stale: true });
  }
  toggle(id: string) {
    const { fit, scope } = this.snapshot;
    if (
      !fit ||
      scope !== relationshipSource().scope ||
      !fit.request.members.some((m) => m.memberId === id)
    )
      return;
    const selected = resolvePopulation(useSetStudioStore.getState()).workingMemberIds.includes(id);
    populationProbeActions.select(
      [id],
      selected ? 'difference' : 'union',
      'map-derived',
      `Spatial relationship ${fit.fitId}`,
    );
  }
  order() {
    const { fit, stale, scope } = this.snapshot;
    if (!fit || stale || scope !== relationshipSource().scope || !fit.geometry.orderable) return;
    this.orderFit = fit;
    const state = useSetStudioStore.getState(),
      scale = Math.max(...fit.geometry.coordinates.map((p) => Math.abs(p[0]))) * 1e-10;
    const positions = fit.request.members
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Math.round(fit.geometry.coordinates[a][0] / scale) -
            Math.round(fit.geometry.coordinates[b][0] / scale) || a - b,
      );
    state.setPopulationPresentation({
      ...state.population.presentation,
      order: {
        rule: 'similarity',
        fitId: fit.fitId,
        featureId: state.selection.activeFeatureId!,
        orderedIds: positions.map((i) => fit.request.members[i].memberId),
        unavailableIds: [],
        label: `MDS axis 1 · ${fit.request.distance} · fit ${fit.fitId.slice(0, 8)}`,
        probe: null,
        bindings: fit.request.members,
        mask: fit.request.mask,
        tieRule: 'source',
      },
    });
  }
  group(count: number) {
    const { fit, stale, scope } = this.snapshot;
    if (!fit || stale || scope !== relationshipSource().scope) return;
    const state = useSetStudioStore.getState();
    state.setPopulationPartition(relationshipPartition(fit, count, state.selection.activeSetId!));
  }
  exportFor(members: PopulationMemberSource[], mask: PopulationMask | null) {
    const { fit, stale, scope } = this.snapshot;
    return fit &&
      !stale &&
      scope === relationshipSource().scope &&
      sameRelationshipBindings(fit.request, { members, mask }, true)
      ? structuredClone(fit)
      : null;
  }
  exportOrderFor(members: PopulationMemberSource[], mask: PopulationMask | null) {
    const fit = this.orderFit;
    return fit &&
      fit.fitId === useSetStudioStore.getState().population.presentation.order?.fitId &&
      this.snapshot.scope === relationshipSource().scope &&
      sameRelationshipBindings(fit.request, { members, mask }, true)
      ? structuredClone(fit)
      : null;
  }
  restore(value: unknown, orderedValue?: unknown) {
    const { source, scope } = relationshipSource();
    if (
      source &&
      scope &&
      validRelationshipFit(value) &&
      sameRelationshipBindings(
        value.request,
        { members: source.members, mask: source.mask ?? null },
        true,
      )
    ) {
      this.resetScope(scope);
      this.install(value, scope);
      const order = validRelationshipFit(orderedValue) ? orderedValue : value;
      this.orderFit =
        order.fitId === useSetStudioStore.getState().population.presentation.order?.fitId &&
        sameRelationshipBindings(
          order.request,
          { members: source.members, mask: source.mask ?? null },
          true,
        )
          ? structuredClone(order)
          : null;
      return true;
    }
    return false;
  }
}
export const populationRelationshipService = new PopulationRelationshipService();

export async function explainRelationship(
  fit: RelationshipFit,
  explanation: {
    field:
      | { kind: 'pair'; a: string; b: string }
      | { kind: 'component'; axis: number }
      | { kind: 'reconstruction'; member: string; components: number };
    crosshairMm: readonly number[];
    orientation: 'axial' | 'sagittal' | 'coronal';
  },
  signal: AbortSignal,
) {
  const source = relationshipSource().source;
  if (
    !source ||
    !(
      sameRelationshipBindings(fit.request, source) ||
      sameRelationshipBindings(fit.request, source, true)
    )
  )
    throw new Error('The fitted sources are not the current verified population.');
  const result = await invokeCancelable<
    RelationshipFit & {
      explanation: { values: (number | null)[]; total: number; label: string; plane: ViewPlane };
    }
  >(
    'fit_population_relationship',
    {
      request: {
        ...fit.request,
        members: source.members.map((m, i) => ({
          ...m,
          expectedSha256: fit.request.members[i].expectedSha256,
        })),
        mask: source.mask
          ? { ...source.mask, expectedSha256: fit.request.mask?.expectedSha256 }
          : null,
        explanation,
      },
    },
    signal,
  );
  signal.throwIfAborted();
  if (
    JSON.stringify(result.geometry.coordinates) !== JSON.stringify(fit.geometry.coordinates) ||
    (fit.geometry.componentScores !== undefined &&
      JSON.stringify(result.geometry.componentScores) !==
        JSON.stringify(fit.geometry.componentScores)) ||
    result.supportSha256 !== fit.supportSha256 ||
    !result.explanation ||
    !result.explanation.plane ||
    result.explanation.plane.dim_px?.join(',') !== '128,128' ||
    [
      result.explanation.plane.origin_mm,
      result.explanation.plane.u_mm,
      result.explanation.plane.v_mm,
    ].some((v) => v.length !== 3 || !v.every(Number.isFinite)) ||
    result.explanation.values.length !== 128 * 128 ||
    result.explanation.values.some((v) => v !== null && !Number.isFinite(v)) ||
    !Number.isFinite(result.explanation.total)
  )
    throw new Error('Spatial explanation does not match the frozen fit.');
  const limit =
    result.explanation.values.reduce<number>((max, v) => Math.max(max, Math.abs(v ?? 0)), 0) || 1;
  return {
    image: new ImageData(
      populationRgba(result.explanation.values, limit, explanation.field.kind !== 'pair'),
      128,
      128,
    ),
    limit,
    plane: result.explanation.plane,
    total: result.explanation.total,
    label: result.explanation.label,
  };
}
