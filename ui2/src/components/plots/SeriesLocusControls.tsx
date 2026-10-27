/**
 * Series locus (phase 4 E2/E5): the voxel at the crosshair, a sphere, an
 * atlas / label region (at the crosshair, or a parcel picked from the
 * legend), or the cluster row selected in the Clusters tab. Shared by the
 * dataset and the 4D-layer series.
 */
import { SegmentedControl, Select, ToolbarField } from '@/components/ui/bf';
import { ValidatedNumberField } from './ValidatedNumberField';
import { isRegionSource } from '@/services/atlasRegionLookup';
import { useLayerStore } from '@/stores/layerStore';
import { useSeriesStore, type SeriesLocusKind } from '@/stores/seriesStore';

const LOCUS_OPTIONS = [
  { value: 'point', label: 'Voxel', title: 'The voxel nearest the crosshair' },
  { value: 'sphere', label: 'Sphere', title: 'A sphere around the crosshair, voxels averaged' },
  { value: 'region', label: 'Region', title: 'An atlas / label region, voxels averaged' },
  { value: 'cluster', label: 'Cluster', title: 'The cluster row selected in the Clusters tab, voxels averaged' },
] as const;

const AT_CROSSHAIR = 'crosshair';

export function SeriesLocusControls({ resolvedRegion = null }: { resolvedRegion?: string | null } = {}) {
  const locus = useSeriesStore((s) => s.locus);
  const radiusMm = useSeriesStore((s) => s.radiusMm);
  const regionPick = useSeriesStore((s) => s.regionPick);
  const update = useSeriesStore((s) => s.update);
  // The region source: the layer of the picked parcel while it exists (what
  // is sampled, REVIEW m11), else the first label layer that names regions.
  const atlas = useLayerStore(
    (s) => (regionPick ? s.layers.find((l) => l.id === regionPick.layerId && isRegionSource(l)) : undefined) ?? s.layers.find(isRegionSource),
  );
  const legend = atlas?.atlasPaletteLegend ?? [];
  const pickValue = regionPick && regionPick.layerId === atlas?.id ? String(regionPick.labelId) : AT_CROSSHAIR;
  // "Crosshair: L_sensorimotor" (the atlas is named in the caption).
  const shortRegion = resolvedRegion ? resolvedRegion.replace(/\s*\(.*\)$/, '') : null;
  // Closed, the select shows the region's name only (v4 visual); the title says it is the crosshair's.
  const crosshairLabel = shortRegion ?? 'At the crosshair';
  const picked = legend.find((e) => String(e.label_id) === pickValue);
  const pickTitle =
    pickValue === AT_CROSSHAIR
      ? resolvedRegion
        ? `The region at the crosshair: ${resolvedRegion}`
        : 'The region at the crosshair'
      : (picked?.displayName ?? picked?.roi);
  return (
    // One no-wrap group: the locus and its parameter never split across rows (v4 visual).
    <span className="inline-flex items-center gap-2 whitespace-nowrap" data-testid="series-locus-group">
      <SegmentedControl
        aria-label="Series locus"
        options={LOCUS_OPTIONS}
        value={locus}
        onValueChange={(v) => update({ locus: v as SeriesLocusKind })}
      />
      {locus === 'sphere' ? (
        <ToolbarField label="Radius">
          <ValidatedNumberField
            aria-label="Series sphere radius"
            fieldClassName="w-[9ch]"
            min={0}
            step={1}
            unit="mm"
            value={radiusMm}
            validate={(v) =>
              v === null ? 'Enter a radius in mm' : v <= 0 ? 'Radius must be > 0 mm (Voxel samples one voxel)' : null
            }
            onCommit={(v) => update({ radiusMm: v })}
          />
        </ToolbarField>
      ) : null}
      {locus === 'region' && atlas ? (
        <ToolbarField label="Region">
          <Select
            aria-label="Series region"
            // A fixed slot on row 1 that ellipsizes, never clipping mid-glyph;
            // the title carries the full name (round 3 C4).
            className="w-[18ch] truncate"
            title={pickTitle}
            value={pickValue}
            onValueChange={(v) =>
              update({ regionPick: v === AT_CROSSHAIR ? null : { layerId: atlas.id, labelId: Number(v) } })
            }
            options={[
              // Names the region the crosshair resolved to.
              { value: AT_CROSSHAIR, label: crosshairLabel },
              ...legend.map((e) => ({
                value: String(e.label_id),
                label: e.displayName ?? e.roi,
              })),
            ]}
          />
        </ToolbarField>
      ) : null}
    </span>
  );
}
