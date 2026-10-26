/**
 * Label maps in the plot dock (P3.12): one bar per region, its voxel count,
 * in the region's LUT colour, names on the axis, instead of a histogram of
 * label ids. The region at the crosshair carries the selection edge. Counts
 * come from the whole-volume histogram (one bin per id, background excluded).
 */
import { useMemo } from 'react';
import type { SampleFrame } from '@/plotting';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import { regionCountsFromFrame } from './regionCounts';
import { useLayerValueAtWorld } from '@/hooks/useLayerValueAtWorld';
import { useViewStateStore } from '@/stores/viewStateStore';

export function RegionCountBars({
  layerId,
  frame,
  legend,
}: {
  layerId: string;
  frame: SampleFrame;
  legend: readonly AtlasPaletteLegendEntry[] | undefined;
}) {
  const regions = useMemo(() => regionCountsFromFrame(frame, legend), [frame, legend]);
  const crosshair = useViewStateStore((s) => s.viewState.crosshair.world_mm);
  const reading = useLayerValueAtWorld(layerId, crosshair);
  const atCrosshair = reading?.value != null ? Math.round(reading.value) : null;
  const max = Math.max(1, ...regions.map((r) => r.count));

  if (regions.length === 0) {
    return (
      <p className="p-3 text-bf-xs text-bf-text-muted" data-testid="region-count-empty">
        No labelled voxels.
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="region-count-bars">
      <div className="flex h-6 items-center justify-between px-2 font-mono text-bf-2xs text-bf-text-muted">
        <span>Regions · voxels</span>
        <span>background (0) excluded</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2" aria-label="Voxels per region">
        {regions.map((r) => {
          const selected = r.id === atCrosshair;
          return (
            <li
              key={r.id}
              className={`grid grid-cols-[minmax(0,14rem)_1fr_7ch] items-center gap-2 py-0.5 text-bf-xs ${
                selected ? 'shadow-[inset_2px_0_0_0_hsl(var(--ring))] bg-bf-bg-selected' : ''
              }`}
              data-region-id={r.id}
              data-at-crosshair={selected ? 'true' : undefined}
              aria-current={selected ? 'location' : undefined}
              title={`${r.name} (label ${r.id}): ${r.count.toLocaleString()} voxels${selected ? ' · at the crosshair' : ''}`}
            >
              <span className="truncate pl-1.5 text-bf-text-secondary">{r.name}</span>
              <span className="h-2.5" aria-hidden>
                <span
                  className="block h-full rounded-bf-xs [forced-color-adjust:none]"
                  style={{
                    width: `${Math.max(1, (r.count / max) * 100)}%`,
                    background: r.color
                      ? `rgb(${r.color[0]}, ${r.color[1]}, ${r.color[2]})`
                      : 'var(--bf-text-muted)',
                  }}
                />
              </span>
              <span className="text-right font-mono tabular-nums text-bf-text-secondary">
                {r.count.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
