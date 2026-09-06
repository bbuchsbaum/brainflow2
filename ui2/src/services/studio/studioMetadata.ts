import type { SpatialFieldSetSummary } from '@/types/studio';

export interface StudioMetadata {
  columns: string[];
  rows: Map<string, Readonly<Record<string, string>>>;
  issue: string | null;
  source: 'observations' | 'legacy-preview';
}

/** Metadata is keyed by original observation identity, never by preview position.
 * Once complete observation records are present, a preview cannot repair or
 * override them. Legacy datasets may use a preview only when it covers the query. */
export function studioMetadata(
  set: SpatialFieldSetSummary,
  requiredIds: readonly string[] = set.memberIds,
): StudioMetadata {
  const rows = new Map<string, Readonly<Record<string, string>>>();
  const members = set.memberSummaries;
  const knownIds = new Set(set.memberIds);
  const full = members.some((member) => member.designValues != null);
  const source = full ? 'observations' : 'legacy-preview';
  const keys = full
    ? [...new Set(members.flatMap((member) => Object.keys(member.designValues ?? {})))].sort()
    : [...(set.designTablePreview?.columns ?? [])];
  const columns = full
    ? [...new Set([...set.designColumns.filter((column) => keys.includes(column)), ...keys])]
    : keys;
  const fail = (issue: string): StudioMetadata => ({ columns, rows: new Map(), issue, source });
  if (
    new Set(columns).size !== columns.length ||
    columns.some((column) => !column.trim() || column !== column.trim())
  )
    return fail('Metadata requires unique nonempty column names.');
  if (full) {
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.id) || !knownIds.has(member.id))
        return fail('Metadata contains duplicate or unknown observation IDs.');
      seen.add(member.id);
      const values = member.designValues;
      if (values == null) continue;
      if (
        Object.keys(values).length !== columns.length ||
        columns.some(
          (column) => !Object.hasOwn(values, column) || typeof values[column] !== 'string',
        )
      )
        return fail('Observation metadata has incomplete or invalid columns.');
      rows.set(member.id, values as Record<string, string>);
    }
  } else {
    for (const row of set.designTablePreview?.rows ?? []) {
      if (
        rows.has(row.id) ||
        row.cells.length !== columns.length ||
        row.cells.some((cell) => typeof cell !== 'string')
      )
        return fail('Metadata requires complete, uniquely keyed rows.');
      rows.set(
        row.id,
        Object.fromEntries(columns.map((column, index) => [column, row.cells[index]])),
      );
    }
  }
  if (requiredIds.some((id) => !rows.has(id)))
    return fail(
      'Metadata requires complete, uniquely keyed records for the requested observations.',
    );
  return { columns, rows, issue: null, source };
}
