import type { ViewPlane } from '@/types/coordinates';
import { populationRgba } from './PopulationSliceService';
import { populationProbeActions } from './PopulationProbeActions';
import { resolvePopulation } from './populationContext';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { buildPopulationSource } from './PopulationProbeController';
import { invokeCancelable } from './PopulationExportService';
import { formatTauriError } from '@/utils/formatTauriError';
import { UNASSIGNED_GROUP_ID } from './populationGroups';
import type {
  PopulationMask,
  PopulationMemberSource,
  PopulationPartition,
} from '@/types/population';
/** v2 eligibility. Absent: v1, which refuses on any unusable member. */
export interface RelationshipEligibility {
  lowCoverageTau: number;
}
/** Low-coverage threshold declared by new fits (user decision, 2026-10-26). */
export const RELATIONSHIP_LOW_COVERAGE_TAU = 0.9;
export interface RelationshipRequest {
  members: PopulationMemberSource[];
  mask: PopulationMask | null;
  region: { worldMm: [number, number, number]; radiusMm: number } | null;
  distance: 'effect' | 'pattern-shape';
  eligibility?: RelationshipEligibility;
}
export type RelationshipUnassignedReason =
  | { kind: 'allMissing' }
  | { kind: 'lowCoverage'; fraction: number }
  | { kind: 'zeroVarianceOnSupport' };
export interface RelationshipUnassigned {
  memberId: string;
  reason: RelationshipUnassignedReason;
  /** Finite voxels on the candidate support. */
  finiteCount: number;
  /** Common voxels this member would have removed had it been fitted. */
  supportLossVoxels: number;
}
export interface RelationshipFit {
  fitId: string;
  /** Full context; restore depends on it. */
  request: RelationshipRequest;
  supportSha256: string;
  candidateVoxels: number;
  /** Common finite voxels of the fitted members. */
  commonVoxels: number;
  /** Per request member. */
  finiteCounts: number[];
  /** Geometry is indexed by this list. Absent in saved v1 fits: every request member. */
  fittedMemberIds?: string[];
  /** Absent in saved v1 fits: none. */
  unassigned?: RelationshipUnassigned[];
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
/** Member IDs indexing the geometry, in fit order. */
export function relationshipFittedIds(fit: RelationshipFit): string[] {
  return fit.fittedMemberIds ?? fit.request.members.map((m) => m.memberId);
}
/** Context members without a fitted position, in request order. */
export function relationshipUnassigned(fit: RelationshipFit): RelationshipUnassigned[] {
  return fit.unassigned ?? [];
}
const unassignedKinds = ['allMissing', 'lowCoverage', 'zeroVarianceOnSupport'];
const unassignedLabels: Record<RelationshipUnassignedReason['kind'], string> = {
  allMissing: 'no finite values',
  lowCoverage: 'low coverage',
  // Judged before the exclusion; the member may vary on the recomputed support.
  zeroVarianceOnSupport: 'constant on the shared voxels before exclusion',
};
/** Interim one-line account of unassigned members; null when there are none. */
export function relationshipUnassignedSummary(fit: RelationshipFit): string | null {
  const unassigned = relationshipUnassigned(fit);
  if (!unassigned.length) return null;
  const counts = new Map<string, number>();
  for (const u of unassigned)
    counts.set(unassignedLabels[u.reason.kind], (counts.get(unassignedLabels[u.reason.kind]) ?? 0) + 1);
  const reasons = [...counts].map(([label, count]) => `${count} ${label}`).join(', ');
  return `${unassigned.length} ${unassigned.length === 1 ? 'observation' : 'observations'} unassigned (${reasons}). Coverage is computed over the fitted maps.`;
}
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
      g = f.geometry,
      ids = f.request.members.map((m) => m.memberId);
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
    const eligibility = f.request.eligibility;
    if (
      eligibility !== undefined &&
      (eligibility === null ||
        typeof eligibility !== 'object' ||
        Object.keys(eligibility).some((key) => key !== 'lowCoverageTau') ||
        !Number.isFinite(eligibility.lowCoverageTau) ||
        eligibility.lowCoverageTau < 0 ||
        eligibility.lowCoverageTau > 1)
    )
      return false;
    if (
      (f.fittedMemberIds !== undefined && !Array.isArray(f.fittedMemberIds)) ||
      (f.unassigned !== undefined && !Array.isArray(f.unassigned))
    )
      return false;
    const fitted = relationshipFittedIds(f),
      unassigned = relationshipUnassigned(f),
      m = fitted.length,
      position = (id: unknown) => ids.indexOf(id as string);
    // Fitted and unassigned members partition the context, each in request order.
    const inOrder = (list: unknown[]) =>
      list.every((id, i) => position(id) >= 0 && (i === 0 || position(id) > position(list[i - 1])));
    if (
      m < 2 ||
      m + unassigned.length !== n ||
      (eligibility === undefined && unassigned.length > 0) ||
      !inOrder(fitted) ||
      !inOrder(unassigned.map((u) => u?.memberId)) ||
      unassigned.some((u) => fitted.includes(u.memberId))
    )
      return false;
    if (
      !Number.isSafeInteger(f.candidateVoxels) ||
      !Number.isSafeInteger(f.commonVoxels) ||
      f.commonVoxels < 2 ||
      f.commonVoxels > f.candidateVoxels ||
      f.finiteCounts.length !== n ||
      f.finiteCounts.some(
        (c, i) =>
          !Number.isSafeInteger(c) ||
          c < 0 ||
          c > f.candidateVoxels ||
          (fitted.includes(ids[i]) && c < f.commonVoxels),
      )
    )
      return false;
    const entryKeys = ['memberId', 'reason', 'finiteCount', 'supportLossVoxels'];
    if (
      unassigned.some(
        (u) =>
          Object.keys(u).some((key) => !entryKeys.includes(key)) ||
          !unassignedKinds.includes(u.reason?.kind) ||
          Object.keys(u.reason).some(
            (key) => key !== 'kind' && !(key === 'fraction' && u.reason.kind === 'lowCoverage'),
          ) ||
          (u.reason.kind === 'lowCoverage' &&
            (!Number.isFinite(u.reason.fraction) ||
              u.reason.fraction < 0 ||
              u.reason.fraction >= eligibility!.lowCoverageTau)) ||
          (u.reason.kind === 'zeroVarianceOnSupport' && f.request.distance === 'effect') ||
          u.finiteCount !== f.finiteCounts[position(u.memberId)] ||
          (u.reason.kind === 'allMissing') !== (u.finiteCount === 0) ||
          !Number.isSafeInteger(u.supportLossVoxels) ||
          u.supportLossVoxels < 0 ||
          u.supportLossVoxels > f.commonVoxels ||
          (u.reason.kind === 'allMissing' && u.supportLossVoxels !== f.commonVoxels),
      )
    )
      return false;
    if (
      (g.componentScores !== undefined &&
        (g.componentScores.length !== m ||
          g.componentScores.some(
            (row) =>
              !Array.isArray(row) ||
              row.length > 8 ||
              row.length !== g.componentScores![0].length ||
              !row.every(Number.isFinite),
          ))) ||
      g.coordinates.length !== m ||
      g.coordinates.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
      g.distances.length !== m ||
      g.distances.some(
        (row, i) =>
          row.length !== m ||
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
      g.eigenvalues.length !== m ||
      g.eigenvalues.some((v) => !Number.isFinite(v) || v < 0) ||
      !Number.isFinite(g.stress) ||
      g.stress < 0 ||
      !Number.isFinite(g.explainedFraction) ||
      g.explainedFraction < 0 ||
      g.explainedFraction > 1 + 1e-8 ||
      typeof g.orderable !== 'boolean' ||
      g.merges.length !== m - 1
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
    const active = new Map(Array.from({ length: m }, (_, i) => [i, 1]));
    for (let i = 0; i < g.merges.length; i++) {
      const merge = g.merges[i];
      if (
        merge.left === merge.right ||
        !active.has(merge.left) ||
        !active.has(merge.right) ||
        merge.count !== active.get(merge.left)! + active.get(merge.right)! ||
        !Number.isFinite(merge.distance) ||
        merge.distance < 0
      )
        return false;
      active.delete(merge.left);
      active.delete(merge.right);
      active.set(m + i, merge.count);
    }
    return true;
  } catch {
    return false;
  }
}
/** The partition group holding unassigned members. Not a similarity group: it has
 * no fitted position, is not counted in the requested group count and carries
 * `origin: 'unassigned'`. Similarity groups carry no per-group origin. */
export const RELATIONSHIP_UNASSIGNED_GROUP_ID = UNASSIGNED_GROUP_ID;
export type RelationshipPartitionGroup = PopulationPartition['groups'][number] & {
  readonly origin?: 'unassigned';
};
export function relationshipPartition(
  fit: RelationshipFit,
  count: number,
  setId: string,
): PopulationPartition {
  const ids = fit.request.members.map((m) => m.memberId);
  if (!validRelationshipFit(fit)) throw new Error('Choose between two groups and the observation count.');
  const fitted = relationshipFittedIds(fit),
    n = fitted.length,
    unassigned = relationshipUnassigned(fit).map((u) => u.memberId);
  if (!Number.isInteger(count) || count < 2 || count > n)
    throw new Error('Choose between two groups and the observation count.');
  const groups = new Map(fitted.map((id, i) => [i, [id]]));
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
      .map(
        (members, i): RelationshipPartitionGroup => ({
          id: `similarity-${i}`,
          label: `Similarity group ${i + 1}`,
          value: String(i + 1),
          memberIds: ids.filter((id) => members.includes(id)),
        }),
      )
      .concat(
        unassigned.length
          ? [
              {
                id: RELATIONSHIP_UNASSIGNED_GROUP_ID,
                label: 'Unassigned',
                value: null,
                memberIds: unassigned,
                origin: 'unassigned',
              },
            ]
          : [],
      ),
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
      eligibility: { lowCoverageTau: RELATIONSHIP_LOW_COVERAGE_TAU },
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
        fit.request.distance !== request.distance ||
        JSON.stringify(fit.request.eligibility ?? null) !==
          JSON.stringify(request.eligibility ?? null)
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
      !relationshipFittedIds(fit).includes(id)
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
      scale = Math.max(...fit.geometry.coordinates.map((p) => Math.abs(p[0]))) * 1e-10,
      fitted = relationshipFittedIds(fit),
      unassigned = relationshipUnassigned(fit).map((u) => u.memberId);
    // Response-order convention: unavailable (unassigned) members follow, in source order.
    const positions = fitted
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
        orderedIds: [...positions.map((i) => fitted[i]), ...unassigned],
        unavailableIds: unassigned,
        label: `MDS axis 1 · ${fit.request.distance} · fit ${fit.fitId.slice(0, 8)}${unassigned.length ? ` · ${unassigned.length} unassigned last` : ''}`,
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
  const unassigned = relationshipUnassigned(fit),
    named =
      explanation.field.kind === 'pair'
        ? [explanation.field.a, explanation.field.b]
        : explanation.field.kind === 'reconstruction'
          ? [explanation.field.member]
          : [];
  const excluded = unassigned.find((u) => named.includes(u.memberId));
  if (excluded)
    throw new Error(`${excluded.memberId} is unassigned in this fit; choose a fitted observation.`);
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
    JSON.stringify(relationshipFittedIds(result)) !== JSON.stringify(relationshipFittedIds(fit)) ||
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
