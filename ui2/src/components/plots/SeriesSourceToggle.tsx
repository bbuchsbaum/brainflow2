/**
 * Series source switch (phase 4 E5), shown only when both a 4D layer and a
 * dataset with a lag / time axis are available.
 */
import { SegmentedControl } from "@/components/ui/bf";
import { useSeriesStore } from "@/stores/seriesStore";
import { useSeriesSource } from "./seriesSource.helpers";

const OPTIONS = [
  { value: "layer", label: "4D layer", title: "The active 4D layer at the crosshair" },
  { value: "set", label: "Dataset", title: "The active dataset's lag / time series at the crosshair" },
] as const;

export function SeriesSourceToggle({ layerId }: { layerId: string | undefined }) {
  const { source, available } = useSeriesSource(layerId);
  const update = useSeriesStore((s) => s.update);
  if (!available.layer || !available.set || !source) return null;
  return (
    <SegmentedControl
      aria-label="Series source"
      options={OPTIONS}
      value={source}
      onValueChange={(v) => update({ source: v as "layer" | "set" })}
    />
  );
}
