import type { PopulationPartition } from '@/types/population';
import type { SpatialFieldSetSummary } from '@/types/studio';
import { studioMetadata } from './studioMetadata';

/** Freeze exact factor membership in context/source order. Empty strings denote
 * missing factor values; literal strings such as 'NA' remain literal levels. */
export function partitionPopulation(
  set: SpatialFieldSetSummary,
  contextIds: readonly string[],
  column: string,
): PopulationPartition {
  const metadata = studioMetadata(set, contextIds);
  if (metadata.issue) throw new Error(metadata.issue);
  if (!metadata.columns.includes(column)) throw new Error('Choose an available factor column.');
  const levels = new Map<string | null, string[]>();
  for (const id of contextIds) {
    const value = metadata.rows.get(id)![column];
    const key = value.trim() ? value : null;
    const members = levels.get(key) ?? [];
    members.push(id);
    levels.set(key, members);
  }
  return {
    setId: set.id,
    column,
    contextIds: [...contextIds],
    origin: 'metadata',
    groups: [...levels].map(([value, memberIds], i) => ({
      id: `factor-${i}`,
      label: value === null ? 'Missing value' : `${column}: ${value}`,
      value,
      memberIds,
    })),
  };
}
export function validatePopulationPartition(
  partition: PopulationPartition,
  setId: string,
  context: readonly string[],
): string | null {
  if (
    !partition ||
    partition.setId !== setId ||
    !['metadata', 'map-derived'].includes(partition.origin) ||
    (partition.origin === 'map-derived' && !/^[a-f0-9]{64}$/i.test(partition.fitId ?? '')) ||
    typeof partition.column !== 'string' ||
    !partition.column.trim() ||
    !Array.isArray(partition.contextIds) ||
    new Set(partition.contextIds).size !== context.length ||
    partition.contextIds.length !== context.length ||
    context.some((id) => !partition.contextIds.includes(id)) ||
    !Array.isArray(partition.groups) ||
    partition.groups.length > context.length
  )
    return 'Grouping belongs to another context. Regroup the current observations.';
  const ids = new Set<string>(),
    groups = new Set<string>();
  for (const group of partition.groups) {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !group.id.trim() ||
      groups.has(group.id) ||
      typeof group.label !== 'string' ||
      !group.label.trim() ||
      !(group.value === null || typeof group.value === 'string') ||
      !Array.isArray(group.memberIds) ||
      !group.memberIds.length
    )
      return 'Grouping requires uniquely identified, nonempty groups.';
    groups.add(group.id);
    for (const id of group.memberIds) {
      if (ids.has(id) || !context.includes(id))
        return 'Factor groups must partition the context exactly once.';
      ids.add(id);
    }
  }
  return ids.size === context.length
    ? null
    : 'Factor groups must include every eligible observation, including missing factor values.';
}
