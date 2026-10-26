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
import { statisticUnits } from '@/utils/statistic';
import { EMPTY_VALUE, formatLayerValue } from '@/utils/valueFormat';
import type { ReadoutPoint } from '@/hooks/useReadoutPoint';

/** Readout sampling waits less than the status bar: it follows the pointer. */
const READOUT_DELAY_MS = 30;

export function LayerReadoutValue({ layerId, point }: { layerId: string; point: ReadoutPoint }) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const dataRange = useLayerStore((s) => s.layerMetadata.get(layerId)?.dataRange);
  const reading = useLayerValueAtWorld(layerId, point.world, READOUT_DELAY_MS);
  const value = reading?.value ?? null;
  const at = point.source === 'pointer' ? 'at the pointer' : 'at the crosshair';

  let content: React.ReactNode = EMPTY_VALUE;
  let title = `${layer?.name ?? layerId}: no value ${at}`;
  const legend = layer?.atlasPaletteLegend;
  if (value !== null && layer?.type === 'label' && legend && legend.length > 0) {
    const id = Math.round(value);
    const entry = id > 0 ? legend.find((e) => e.label_id === id) : undefined;
    const name = entry ? formatRegionLabel(entry) : id > 0 ? `label ${id}` : EMPTY_VALUE;
    // Region names are text, not numbers: sans like the status Region slot.
    content = <span className="font-sans">{name}</span>;
    title = `${layer.name}: ${entry ? `${formatRegionLabel(entry)} (label ${id})` : id > 0 ? `label ${id}` : 'background'} ${at}`;
  } else if (value !== null) {
    const units = statisticUnits(layer?.statistic, dataRange);
    const number = formatLayerValue(value);
    content = units ? (
      <>
        <StatSymbol label={units} className="font-sans text-bf-text-muted" /> {number}
      </>
    ) : (
      number
    );
    title = `${layer?.name ?? layerId}: ${units ? `${units} ` : ''}${number} ${at}`;
  }

  return (
    <span
      className="max-w-[16ch] shrink-0 truncate text-right font-mono text-bf-xs tabular-nums text-bf-text-secondary"
      title={title}
      data-testid={`layer-readout-${layerId}`}
    >
      {content}
    </span>
  );
}
