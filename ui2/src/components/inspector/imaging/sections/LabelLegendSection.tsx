/**
 * Regions section for a label layer (catalogue atlas or a user label volume
 * with a label table): the legend in place of a continuous colorbar. One row
 * per region (LUT swatch, id, name); the region at the crosshair is
 * emphasised (weight, not the selection edge: it is a position, not a pick).
 */
import React from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { Section } from '@/components/ui/bf';
import { formatRegionLabel } from '@/services/atlasRegionLookup';
import type { SceneItem } from '@/types/sceneItem';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';

const EMPTY: AtlasPaletteLegendEntry[] = [];

export function LabelLegendSection({ item }: { item: SceneItem }) {
  const layerId = item.ref.type === 'volume' ? item.ref.layerId : null;
  const legend = useLayerStore((s) =>
    layerId ? (s.layers.find((l) => l.id === layerId)?.atlasPaletteLegend ?? EMPTY) : EMPTY,
  );
  const region = useStatusBarStore((s) => s.values.region);
  if (legend.length === 0) return null;
  const current = typeof region === 'string' ? region : null;

  return (
    <Section title={`Regions (${legend.length})`} defaultOpen>
      <ul
        className="max-h-56 overflow-y-auto text-bf-xs"
        aria-label="Region legend"
        data-testid="label-legend"
      >
        {legend.map((entry) => {
          const name = formatRegionLabel(entry);
          const atCrosshair = name === current;
          return (
            <li
              key={entry.label_id}
              className={`flex min-w-0 items-center gap-2 py-0.5 ${
                atCrosshair ? 'font-medium text-foreground' : 'text-bf-text-secondary'
              }`}
              aria-current={atCrosshair ? 'location' : undefined}
              title={atCrosshair ? `${name} (at the crosshair)` : name}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-bf-xs outline outline-1 outline-[var(--bf-border)] [forced-color-adjust:none]"
                // Data colour: the label's LUT entry.
                style={{
                  background: `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`,
                }}
              />
              <span className="w-8 shrink-0 text-right font-mono tabular-nums text-bf-text-muted">
                {entry.label_id}
              </span>
              <span className="min-w-0 truncate">{name}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
