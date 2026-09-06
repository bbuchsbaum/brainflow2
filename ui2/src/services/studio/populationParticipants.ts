import type { SampleFrame } from '@/plotting';
import type { SpatialFieldSetSummary } from '@/types/studio';
import type { PopulationParticipantDefinition } from '@/types/population';
import type { PopulationContextHost } from './populationContext';

export interface ParticipantGroup {
  participantId: string;
  memberIds: string[];
}
export interface ParticipantAggregation {
  within: 'single' | 'mean';
  groups: ParticipantGroup[];
}

/** Explicit identity mapping. Names and filename patterns never imply people. */
export function participantIdentity(
  set: SpatialFieldSetSummary,
  definition: PopulationParticipantDefinition,
) {
  if (definition.setId !== set.id)
    throw new Error('Participant identity belongs to another dataset.');
  const ids = set.memberIds;
  if (new Set(ids).size !== ids.length || ids.some((id) => !id.trim() || id !== id.trim()))
    throw new Error('Participant identity requires unique observation IDs.');
  if (definition.identity.kind === 'observationIds') return new Map(ids.map((id) => [id, id]));
  const table = set.designTablePreview;
  const column = definition.identity.column;
  if (!table || table.columns.filter((name) => name === column).length !== 1)
    throw new Error('Choose an available, uniquely named participant ID column.');
  const index = table.columns.indexOf(column),
    rows = new Map(table.rows.map((row) => [row.id, row]));
  if (
    rows.size !== table.rows.length ||
    ids.some((id) => !rows.has(id) || rows.get(id)!.cells.length !== table.columns.length)
  )
    throw new Error(
      'Participant identity requires complete, uniquely keyed metadata for every observation.',
    );
  return new Map(
    ids.map((id) => {
      const participant = rows.get(id)!.cells[index];
      if (
        typeof participant !== 'string' ||
        !participant.trim() ||
        participant !== participant.trim()
      )
        throw new Error(
          `Observation ${id} needs a nonempty participant ID without surrounding whitespace.`,
        );
      return [id, participant];
    }),
  );
}

export function groupParticipantMembers(
  identity: ReadonlyMap<string, string>,
  members: readonly string[],
): ParticipantGroup[] {
  const groups = new Map<string, string[]>();
  for (const id of members) {
    const participant = identity.get(id);
    if (!participant) throw new Error(`Observation ${id} has no declared participant identity.`);
    const group = groups.get(participant) ?? [];
    if (group.includes(id)) throw new Error('Participant groups require unique observation IDs.');
    group.push(id);
    groups.set(participant, group);
  }
  return [...groups].map(([participantId, memberIds]) => ({ participantId, memberIds }));
}

export function resolvePopulationParticipants(
  state: PopulationContextHost & {
    population: { participants: PopulationParticipantDefinition | null };
  },
  members: readonly string[],
) {
  const definition = state.population.participants;
  if (!definition) return { identity: null, groups: [], aggregation: null, issue: null } as const;
  try {
    const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
    if (!set) throw new Error('The participant dataset is unavailable.');
    const identity = participantIdentity(set, definition);
    const groups = groupParticipantMembers(identity, members);
    if (definition.reduction === 'single' && groups.some((group) => group.memberIds.length !== 1))
      return {
        identity,
        groups,
        aggregation: null,
        issue:
          'Participant summaries require one selected observation per person. Select one row per person or explicitly average their selected rows.',
      };
    const aggregation: ParticipantAggregation | null =
      definition.reduction === 'observations' ? null : { within: definition.reduction, groups };
    return { identity, groups, aggregation, issue: null };
  } catch (error) {
    return {
      identity: null,
      groups: [],
      aggregation: null,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Reduce spatially sampled responses within each participant, keeping the
 * original sample frame for the plot. Missing rows never become measured zeros. */
export function participantProbeFrame(
  frame: SampleFrame,
  aggregation: ParticipantAggregation,
): SampleFrame {
  const rows = new Map(frame.rows.map((row) => [String(row.member), row]));
  if (rows.size !== frame.rows.length)
    throw new Error('Participant reduction requires unique sampled observation IDs.');
  const participantIds = new Set<string>();
  const memberIds = new Set<string>();
  if (aggregation.within !== 'single' && aggregation.within !== 'mean')
    throw new Error('Unsupported within-participant reduction.');
  for (const group of aggregation.groups) {
    if (
      !group.participantId.trim() ||
      group.participantId !== group.participantId.trim() ||
      participantIds.has(group.participantId) ||
      !group.memberIds.length
    )
      throw new Error('Participant reduction requires unique nonempty participant groups.');
    participantIds.add(group.participantId);
    for (const id of group.memberIds) {
      if (memberIds.has(id))
        throw new Error('An observation cannot contribute to multiple participant groups.');
      memberIds.add(id);
    }
  }
  return {
    columns: [
      { name: 'member', role: 'nominal' },
      { name: 'value', role: 'quantitative' },
      { name: 'observationCount', role: 'quantitative' },
      { name: 'validCount', role: 'quantitative' },
    ],
    rows: aggregation.groups.map((group) => {
      if (aggregation.within === 'single' && group.memberIds.length !== 1)
        throw new Error('Single-observation participant reduction received repeated rows.');
      let mean = 0,
        count = 0;
      for (const id of group.memberIds) {
        const row = rows.get(id);
        if (!row) throw new Error(`Missing sampled observation ${id}.`);
        const value = row.value;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        count++;
        mean =
          mean < 0 !== value < 0
            ? mean * ((count - 1) / count) + value / count
            : mean + (value - mean) / count;
      }
      return {
        member: group.participantId,
        value: count ? mean : null,
        observationCount: group.memberIds.length,
        validCount: count,
      };
    }),
    meta: {
      ...frame.meta,
      analysisUnit: 'participant',
      withinParticipant: aggregation.within,
      participantGroups: aggregation.groups,
    },
  };
}
