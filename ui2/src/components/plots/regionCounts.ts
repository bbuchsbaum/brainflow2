import type { SampleFrame } from '@/plotting';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import { formatRegionLabel } from '@/services/atlasRegionLookup';

export interface RegionCount {
  id: number;
  name: string;
  color: [number, number, number] | null;
  count: number;
}

/** Per-id voxel counts from a histogram frame whose bins hold one integer each. */
export function regionCountsFromFrame(
  frame: SampleFrame,
  legend: readonly AtlasPaletteLegendEntry[] | undefined,
): RegionCount[] {
  const counts = new Map<number, number>();
  for (const row of frame.rows) {
    const x0 = Number(row.binStart);
    const x1 = Number(row.binEnd);
    const count = Number(row.count);
    if (!(count > 0)) continue;
    // The integer id this bin holds (bins are narrower than 1); a bin
    // holding none is empty by construction.
    const label = Math.ceil(x0 - 1e-9);
    if (label > x1 + 1e-9 || label === 0) continue;
    counts.set(label, (counts.get(label) ?? 0) + count);
  }
  const byId = new Map((legend ?? []).map((e) => [e.label_id, e]));
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, count]) => {
      const entry = byId.get(id);
      return {
        id,
        name: entry ? formatRegionLabel(entry) : `label ${id}`,
        color: entry ? entry.color : null,
        count,
      };
    });
}

