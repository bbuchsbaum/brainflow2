import type { SegmentationLabelDefinition } from '@brainflow/api';
export function parseSegmentationLabels(source: string): SegmentationLabelDefinition[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Provide at least one label.');
  const ids = new Set<number>();
  const labels = parsed.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Each label must be an object.');
    const label = raw as Record<string, unknown>, id = label.id, color = label.color;
    if (!Number.isInteger(id) || (id as number) < 1 || (id as number) > 65535 || ids.has(id as number)) throw new Error('Label ids must be unique integers from 1 to 65535.');
    if (typeof label.name !== 'string' || !label.name.trim() || typeof label.abbreviation !== 'string' || !label.abbreviation.trim()) throw new Error('Every label needs a name and abbreviation.');
    if (!Array.isArray(color) || color.length !== 3 || color.some((v) => !Number.isInteger(v) || (v as number) < 0 || (v as number) > 255)) throw new Error('Label colors must be RGB integers from 0 to 255.');
    if (label.parent != null && (!Number.isInteger(label.parent) || (label.parent as number) < 1)) throw new Error('Label parents must be a label id or null.');
    ids.add(id as number);
    return { id: id as number, name: label.name.trim(), abbreviation: label.abbreviation.trim(), color: color as [number, number, number], parent: label.parent == null ? null : label.parent as number };
  });
  for (const label of labels) {
    const seen = new Set([label.id]); let parent = label.parent;
    while (parent !== null) { if (seen.has(parent)) throw new Error('The label hierarchy contains a cycle.'); seen.add(parent); const row = labels.find((other) => other.id === parent); if (!row) throw new Error('A label parent is missing from the table.'); parent = row.parent; }
  }
  return labels;
}
