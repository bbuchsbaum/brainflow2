/**
 * Locus of a 4D layer's series (phase 4 E2/E3): the crosshair (voxel or
 * sphere, sized in the encoding panel), an atlas / label region, or the
 * selected cluster row. Region and cluster share the Series locus settings.
 */
import { SegmentedControl, Select, ToolbarField } from '@/components/ui/bf';
import { isRegionSource } from '@/services/atlasRegionLookup';
import type { SeriesRegion } from '@/services/series/seriesRegion';
import { useLayerStore } from '@/stores/layerStore';
import { useSeriesStore } from '@/stores/seriesStore';

const OPTIONS = [
  { value: 'crosshair', label: 'Crosshair', title: 'The voxel or sphere at the crosshair' },
  { value: 'region', label: 'Region', title: 'An atlas / label region, voxels averaged' },
  { value: 'cluster', label: 'Cluster', title: 'The cluster row selected in the Clusters tab, voxels averaged' },
] as const;

export function RawSeriesLocus({ region }: { region: SeriesRegion | null }) {
  const locus = useSeriesStore((s) => s.locus);
  const regionPick = useSeriesStore((s) => s.regionPick);
  const update = useSeriesStore((s) => s.update);
  const atlas = useLayerStore((s) => s.layers.find(isRegionSource));
  const value = locus === 'region' || locus === 'cluster' ? locus : 'crosshair';
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-bf-xs" data-testid="raw-series-locus">
      <SegmentedControl
        aria-label="Series locus"
        options={OPTIONS}
        value={value}
        onValueChange={(v) => update({ locus: v === 'crosshair' ? 'point' : (v as 'region' | 'cluster') })}
      />
      {locus === 'region' && atlas ? (
        <ToolbarField label="Region">
          <Select
            aria-label="Series region"
            className="w-auto max-w-[220px]"
            value={regionPick && regionPick.layerId === atlas.id ? String(regionPick.labelId) : 'crosshair'}
            onValueChange={(v) =>
              update({ regionPick: v === 'crosshair' ? null : { layerId: atlas.id, labelId: Number(v) } })
            }
            options={[
              { value: 'crosshair', label: 'At the crosshair' },
              ...(atlas.atlasPaletteLegend ?? []).map((e) => ({ value: String(e.label_id), label: e.displayName ?? e.roi })),
            ]}
          />
        </ToolbarField>
      ) : null}
      {region ? (
        <span className="text-bf-text-muted" data-testid="raw-series-region">
          {region.region ? region.label : region.issue}
        </span>
      ) : null}
    </div>
  );
}
