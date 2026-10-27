import type { SeriesAxis, StudioMemberSummary } from '@brainflow/api';

/**
 * One line describing a NeuroTabs series axis for the import summary:
 * "lag (TR), 6 positions", or for an observation column
 * "time (s) from column onset, 30 distinct values".
 */
export function seriesAxisLabel(
  axis: SeriesAxis,
  members: readonly StudioMemberSummary[] = [],
): string {
  const head = axis.unit ? `${axis.kind} (${axis.unit})` : axis.kind;
  if (axis.source.type === 'observation_column') {
    const column = axis.source.column;
    const values = new Set<string>();
    let complete = members.length > 0;
    for (const member of members) {
      const value = member.designValues?.[column];
      if (member.designValues == null) complete = false;
      if (value != null && value !== '') values.add(value);
    }
    const distinct = complete ? values.size : axis.count;
    return distinct == null
      ? `${head} from column ${column}`
      : `${head} from column ${column}, ${distinct} distinct ${distinct === 1 ? 'value' : 'values'}`;
  }
  return axis.count == null
    ? head
    : `${head}, ${axis.count} ${axis.count === 1 ? 'position' : 'positions'}`;
}
