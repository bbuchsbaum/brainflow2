import type { SampleFrame } from './types';

/** Join one metadata record per observation without changing sampled row grain.
 * Reserved/colliding names receive an explicit alias, so an input column named
 * value, member or count can never replace a measurement or its provenance. */
export function attachObservationMetadata(
  frame: SampleFrame,
  observations: readonly {
    memberId: string;
    designValues?: readonly { column: string; value: string }[];
  }[],
): SampleFrame {
  const records = new Map<string, Map<string, string>>();
  const names = new Set<string>();
  for (const observation of observations) {
    if (records.has(observation.memberId))
      throw new Error('Duplicate observation metadata identity.');
    const record = new Map<string, string>();
    for (const { column, value } of observation.designValues ?? []) {
      if (!column.trim() || record.has(column) || typeof value !== 'string')
        throw new Error('Observation metadata requires unique named string fields.');
      record.set(column, value);
      names.add(column);
    }
    records.set(observation.memberId, record);
  }
  if (!names.size) return frame;
  const occupied = new Set([
    'member',
    'memberLabel',
    'participant',
    'value',
    'lower',
    'upper',
    'count',
    't',
    ...frame.columns.map((column) => column.name),
    ...frame.rows.flatMap((row) => Object.keys(row)),
  ]);
  const aliases = new Map<string, string>();
  for (const name of names) {
    const base = occupied.has(name) ? `design:${name}` : name;
    let alias = base;
    let suffix = 2;
    while (occupied.has(alias)) alias = `${base}:${suffix++}`;
    aliases.set(name, alias);
    occupied.add(alias);
  }
  const valueIndex = frame.columns.findIndex((column) => column.name === 'value');
  const insertAt = valueIndex < 0 ? frame.columns.length : valueIndex;
  return {
    ...frame,
    columns: [
      ...frame.columns.slice(0, insertAt),
      ...[...aliases.values()].map((name) => ({ name, role: 'nominal' as const })),
      ...frame.columns.slice(insertAt),
    ],
    rows: frame.rows.map((row) => ({
      ...row,
      ...Object.fromEntries(
        [...aliases].map(([name, alias]) => [
          alias,
          records.get(String(row.member))?.get(name) ?? null,
        ]),
      ),
    })),
    meta: {
      ...frame.meta,
      designColumns: [...aliases.values()],
      designColumnAliases: Object.fromEntries(aliases),
    },
  };
}
