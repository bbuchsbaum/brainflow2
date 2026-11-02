/**
 * Regions section for a label layer (catalogue atlas or a user label volume
 * with a label table): the legend in place of a continuous colorbar. One row
 * per region (LUT swatch, id, name). The region at the crosshair is
 * emphasised by weight; a picked region gets the selected-row form.
 *
 * Picking a row selects that region for the outline (Display: Outline / Both
 * then draws only its boundary) and, for catalogue atlases whose ROI
 * locations the backend knows, moves the crosshair to it. Picking it again
 * clears the pick.
 *
 * Right-clicking a row opens the app menu (never WebKit's; QA run 5 N25):
 * Go to region, Use as series region, Copy name.
 */
import React, { useCallback } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import {
  Section,
  SELECTED,
  HOVER_FILL,
  FOCUS_RING_INSET,
  useRovingFocus,
} from '@/components/ui/bf';
import { formatRegionLabel } from '@/services/atlasRegionLookup';
import { getEventBus } from '@/events/EventBus';
import { openRegionSeries, regionSeriesUnavailable } from '@/services/series/openClusterSeries';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { atlasRoiService } from '@/services/AtlasRoiService';
import { DEFAULT_LABEL_OUTLINE } from '@/utils/labelDisplay';
import type { SceneItem } from '@/types/sceneItem';
import type { AtlasPaletteLegendEntry } from '@/types/atlasPalette';
import { cn } from '@/utils/cn';

const EMPTY: AtlasPaletteLegendEntry[] = [];

export function LabelLegendSection({ item }: { item: SceneItem }) {
  const layerId = item.ref.type === 'volume' ? item.ref.layerId : null;
  const legend = useLayerStore((s) =>
    layerId ? (s.layers.find((l) => l.id === layerId)?.atlasPaletteLegend ?? EMPTY) : EMPTY,
  );
  const volumeId = useLayerStore((s) =>
    layerId ? s.layers.find((l) => l.id === layerId)?.volumeId : undefined,
  );
  const isCatalogue = useLayerStore((s) => {
    const layer = layerId ? s.layers.find((l) => l.id === layerId) : undefined;
    return !!layer && (layer.source === 'atlas' || !!layer.atlasMetadata);
  });
  const pickedId = useViewStateStore((s) =>
    layerId ? (s.viewState.layers.find((l) => l.id === layerId)?.outline?.selectedLabelId ?? 0) : 0,
  );
  const region = useStatusBarStore((s) => s.values.region);
  const current = typeof region === 'string' ? region : null;

  const pick = useCallback(
    async (labelId: number, toggle = true) => {
      if (!layerId) return;
      const next = toggle && pickedId === labelId ? 0 : labelId;
      useViewStateStore.getState().setViewState((state) => {
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return;
        layer.outline = { ...(layer.outline ?? DEFAULT_LABEL_OUTLINE), selectedLabelId: next };
      });
      if (next === 0 || !isCatalogue || !volumeId) return;
      try {
        const roi = (await atlasRoiService.locations(volumeId)).find((r) => r.id === next);
        if (roi?.worldMm) await atlasRoiService.focus(layerId, roi);
      } catch {
        // No ROI location: the pick still selects the region.
      }
    },
    [layerId, pickedId, isCatalogue, volumeId],
  );

  const copyName = useCallback(async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      getEventBus().emit('ui.notification', { type: 'info', message: `Copied "${name}"` });
    } catch {
      getEventBus().emit('ui.notification', { type: 'warning', message: 'Could not copy to the clipboard' });
    }
  }, []);

  const openRowMenu = useCallback(
    (entry: AtlasPaletteLegendEntry, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!layerId) return;
      const name = formatRegionLabel(entry);
      const seriesBlocked = regionSeriesUnavailable(layerId);
      useContextMenuStore.getState().open(event.clientX, event.clientY, [
        {
          id: 'region.goTo',
          // Without a known ROI location the region is still selected (outlined).
          label: isCatalogue && volumeId ? 'Go to region' : 'Select region',
          onClick: () => void pick(entry.label_id, false),
        },
        {
          id: 'region.useAsSeriesRegion',
          label: seriesBlocked
            ? `Use as series region (${seriesBlocked.replace(/\.$/, '')})`
            : 'Use as series region',
          disabled: !!seriesBlocked,
          onClick: () => openRegionSeries(layerId, entry.label_id),
        },
        { id: 'region.sep', label: '', separator: true },
        { id: 'region.copyName', label: 'Copy name', onClick: () => void copyName(name) },
      ]);
    },
    [layerId, isCatalogue, volumeId, pick, copyName],
  );

  const ids = legend.map((e) => String(e.label_id));
  const roving = useRovingFocus({ ids, activeId: pickedId ? String(pickedId) : null });

  if (legend.length === 0) return null;

  return (
    <Section title={`Regions (${legend.length})`} defaultOpen>
      <ul
        role="listbox"
        aria-label="Regions"
        className="max-h-56 overflow-y-auto text-bf-xs"
        data-testid="label-legend"
        onKeyDown={roving.onKeyDown}
      >
        {legend.map((entry) => {
          const name = formatRegionLabel(entry);
          const atCrosshair = name === current;
          const picked = entry.label_id === pickedId;
          return (
            <li
              key={entry.label_id}
              role="option"
              aria-selected={picked}
              {...roving.getItemProps(String(entry.label_id))}
              className={cn(
                'flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5',
                picked ? SELECTED : HOVER_FILL,
                FOCUS_RING_INSET,
                atCrosshair ? 'font-medium text-foreground' : !picked && 'text-bf-text-secondary',
              )}
              aria-current={atCrosshair ? 'location' : undefined}
              title={`${name}${atCrosshair ? ' (at the crosshair)' : ''}: ${picked ? 'click to clear' : 'click to select'}`}
              onClick={() => void pick(entry.label_id)}
              onContextMenu={(e) => openRowMenu(entry, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void pick(entry.label_id);
                }
              }}
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
