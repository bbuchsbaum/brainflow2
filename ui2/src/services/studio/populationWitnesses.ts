import type { SampleFrame } from '@/plotting';
import type { PopulationProbeQuery, PopulationProbeResult } from './PopulationProbeController';

/** Explicit presentation fit. It retains observed IDs and sampling provenance;
 * selection and hover do not refit it. No reconstructed observations. */
export interface PopulationArrangement {
  readonly query: PopulationProbeQuery;
  readonly sources: SampleFrame['meta'];
  readonly orderedIds: readonly string[];
  readonly witnessIds: readonly string[];
  readonly unavailableIds: readonly string[];
  readonly mode: 'all' | 'witnesses';
}

export function populationBindingKey(query: PopulationProbeQuery): string {
  return JSON.stringify([
    query.datasetKey,
    query.request.locus.kind === 'set' ? query.request.locus.members : null,
    query.request.locus.kind === 'set' ? (query.request.locus.mask ?? null) : null,
  ]);
}

export function arrangePopulationResponses(
  result: PopulationProbeResult,
  mode: PopulationArrangement['mode'],
  count = 12,
): PopulationArrangement {
  if (!Number.isInteger(count) || count < 2 || count > 80)
    throw new Error('Witness count must be an integer from 2 to 80.');
  const ids =
    result.query.request.locus.kind === 'set'
      ? result.query.request.locus.members.map((member) => member.memberId)
      : [];
  const rows = new Map(result.frame.rows.map((row) => [row.member, row]));
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    rows.size !== ids.length ||
    result.frame.rows.length !== ids.length ||
    ids.some((id) => !rows.has(id))
  )
    throw new Error('Response ordering requires exactly one sample per eligible observation.');
  const finite: { id: string; value: number; index: number }[] = [];
  const unavailableIds: string[] = [];
  ids.forEach((id, index) => {
    const value = rows.get(id)!.value;
    if (typeof value === 'number' && Number.isFinite(value)) finite.push({ id, value, index });
    else unavailableIds.push(id);
  });
  finite.sort((a, b) => a.value - b.value || a.index - b.index);
  const n = Math.min(count, finite.length);
  // Nearest empirical ranks including both endpoints; ties retain source order.
  // This chooses actual observations, not interpolated quantile fields.
  const witnessIds = Array.from(
    { length: n },
    (_, i) => finite[n === 1 ? 0 : Math.round((i * (finite.length - 1)) / (n - 1))].id,
  );
  return {
    query: structuredClone(result.query),
    sources: structuredClone(result.frame.meta),
    orderedIds: [...finite.map((row) => row.id), ...unavailableIds],
    witnessIds,
    unavailableIds,
    mode,
  };
}

/** Plot retains everyone, even when the gallery displays a witness sample. */
export function orderPopulationFrame(
  frame: SampleFrame,
  arrangement: PopulationArrangement | null,
): SampleFrame {
  if (!arrangement) return frame;
  const rows = new Map(frame.rows.map((row) => [String(row.member), row]));
  if (
    rows.size !== arrangement.orderedIds.length ||
    arrangement.orderedIds.some((id) => !rows.has(id))
  )
    return frame;
  return { ...frame, rows: arrangement.orderedIds.map((id) => rows.get(id)!) };
}

export function populationArrangementLabel(arrangement: PopulationArrangement): string {
  const probe = arrangement.query.probe;
  return `Response order at (${probe.worldMm.map((v) => v.toFixed(1)).join(', ')}) mm · ${probe.radiusMm ? `${probe.reduce} in ${probe.radiusMm} mm sphere` : 'point'} · ties in source order · ${arrangement.unavailableIds.length} unavailable last`;
}

/** An order is a fit to sampled sources, not a promise about newer images. */
export function populationOrderSourceStatus(
  arrangement: PopulationArrangement,
  sources: readonly { memberId: string; sha256: string | null; maskSha256?: string | null }[],
): 'same' | 'changed' | 'unknown' {
  const recorded = arrangement.sources?.sources;
  if (
    !recorded ||
    recorded.length !== arrangement.orderedIds.length ||
    new Set(recorded.map((source) => source.memberId)).size !== recorded.length ||
    arrangement.orderedIds.some((id) => !recorded.some((source) => source.memberId === id)) ||
    recorded.some((source) => !source.sourceRevision?.sha256)
  )
    return 'unknown';
  const masked =
    arrangement.query.request.locus.kind === 'set' && !!arrangement.query.request.locus.mask;
  if (masked) {
    const masks = new Map(sources.map((source) => [source.memberId, source.maskSha256]));
    if (recorded.some((source) => !source.maskRevision?.sha256 || !masks.get(source.memberId)))
      return 'unknown';
    if (recorded.some((source) => masks.get(source.memberId) !== source.maskRevision!.sha256))
      return 'changed';
  }
  const current = new Map(sources.map((source) => [source.memberId, source.sha256]));
  if (arrangement.orderedIds.some((id) => !current.get(id))) return 'unknown';
  return recorded.every((source) => current.get(source.memberId) === source.sourceRevision!.sha256)
    ? 'same'
    : 'changed';
}
