import type { SampleFrame } from '@/plotting';
import type { PopulationPartition } from '@/types/population';
export function populationPivot(partition: PopulationPartition, frame: SampleFrame) {
  if (!partition.factorColumns || partition.factorColumns.length !== 2)
    throw new Error('A pivot requires an explicit two-factor partition.');
  const byId = new Map(frame.rows.map((r) => [String(r.member), r.value]));
  if (byId.size !== frame.rows.length || partition.contextIds.some((id) => !byId.has(id)))
    throw new Error('The sampled probe does not cover this grouping.');
  const rows = new Set<string | null>(),
    columns = new Set<string | null>();
  const cells = partition.groups.map((group) => {
    const levels: unknown = JSON.parse(group.value ?? 'null');
    if (
      !Array.isArray(levels) ||
      levels.length !== 2 ||
      levels.some((v) => v !== null && typeof v !== 'string')
    )
      throw new Error('Invalid two-factor levels.');
    const [row, column] = levels as [string | null, string | null];
    rows.add(row);
    columns.add(column);
    let n = 0,
      mean = 0;
    for (const id of group.memberIds) {
      const value = byId.get(id);
      if (typeof value === 'number' && Number.isFinite(value)) {
        n++;
        mean += (value - mean) / n;
      }
    }
    return { group, row, column, count: group.memberIds.length, valid: n, mean: n ? mean : null };
  });
  return { rows: [...rows], columns: [...columns], cells };
}
