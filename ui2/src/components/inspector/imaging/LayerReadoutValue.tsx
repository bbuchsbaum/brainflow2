/**
 * One volume layer's value at the readout point (pointer over a slice, else
 * the crosshair), shown in its Scene row (UI redesign phase 3, item 6).
 * The row names the layer, so the value never stands alone:
 * - statistic maps: the symbol then the number ("z 5.43");
 * - label layers with a legend: the region name ("L_sensorimotor");
 * - other volumes: the number, at the precision of its scale ("167").
 * "—" outside the volume or on background (label 0).
 */
import React from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useLayerValueAtWorld } from '@/hooks/useLayerValueAtWorld';
import { formatRegionLabel } from '@/services/atlasRegionLookup';
import { StatSymbol } from '@/components/ui/StatSymbol';
import { statisticLongName, statisticUnits } from '@/utils/statistic';
import { EMPTY_VALUE, formatLayerValue } from '@/utils/valueFormat';
import type { ReadoutPoint } from '@/hooks/useReadoutPoint';

/** Readout sampling waits less than the status bar: it follows the pointer. */
const READOUT_DELAY_MS = 30;

export function LayerReadoutValue({
  layerId,
  point,
  id,
}: {
  layerId: string;
  point: ReadoutPoint;
  id?: string;
}) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const dataRange = useLayerStore((s) => s.layerMetadata.get(layerId)?.dataRange);
  // A label map (catalogue atlas or user table) reads like the status Region
  // slot: the backend's sample, whose outside is label 0 (background). The
  // frontend grid test could disagree with an atlas's resampled grid and
  // show "—" where the status bar named the region (native v6).
  const reading = useLayerValueAtWorld(layerId, point.world, READOUT_DELAY_MS, layer?.type === 'label');
  const value = reading?.value ?? null;
  const at = point.source === 'pointer' ? 'at the pointer' : 'at the crosshair';

  let content: React.ReactNode = EMPTY_VALUE;
  let title = `${layer?.name ?? layerId}: no value ${at}`;
  const legend = layer?.atlasPaletteLegend;
  if (value !== null && layer?.type === 'label' && legend && legend.length > 0) {
    const id = Math.round(value);
    const entry = id > 0 ? legend.find((e) => e.label_id === id) : undefined;
    const name = entry ? formatRegionLabel(entry) : id > 0 ? `label ${id}` : EMPTY_VALUE;
    // Region names are text, not numbers: sans with the region's LUT
    // swatch, like the status Region slot.
    content = (
      <span className="flex min-w-0 items-center gap-1 font-sans">
        {entry ? (
          <span
            aria-hidden
            data-testid="scene-region-swatch"
            className="h-1.5 w-1.5 shrink-0 rounded-bf-xs [forced-color-adjust:none]"
            style={{ background: `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})` }}
          />
        ) : null}
        <span className="min-w-0 truncate" data-testid="scene-region-name">
          {name}
        </span>
      </span>
    );
    title = `${layer.name}: ${entry ? `${formatRegionLabel(entry)} (label ${id})` : id > 0 ? `label ${id}` : 'background'} ${at}`;
  } else if (value !== null) {
    const units = statisticUnits(layer?.statistic, dataRange);
    const number = formatLayerValue(value);
    content = (
      <span className="min-w-0 truncate">
        {units ? (
          <>
            <StatSymbol label={units} className="font-sans text-bf-text-muted" /> {number}
          </>
        ) : (
          number
        )}
      </span>
    );
    // The description is read aloud: the long name, not "z*".
    title = `${layer?.name ?? layerId}: ${units ? `${statisticLongName(units)} ` : ''}${number} ${at}`;
  }

  return (
    <span
      id={id}
      // Room for a region name ("R_occipitotemporal"): the layer name column
      // gives way first; a longer value ends in an ellipsis, never a hard cut.
      className="flex min-w-0 max-w-[24ch] shrink-0 justify-end overflow-hidden text-right font-mono text-bf-xs tabular-nums text-bf-text-secondary"
      title={title}
      data-testid={`layer-readout-${layerId}`}
    >
      {content}
    </span>
  );
}
