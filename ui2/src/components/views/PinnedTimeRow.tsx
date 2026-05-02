/**
 * PinnedTimeRow — Phase 5a element of the integrated workspace.
 *
 * A thin, top-pinned row that mounts a `PlotHost` with only the crosshair
 * time-series mode. Self-gates on the active layer being 4D — returns `null`
 * for 3D layers (or no layer) so the host workspace can elide the surrounding
 * pane entirely.
 *
 * Owns no plot logic itself; the time-series sampling, throttling, and
 * voxel-bounds gating live in `crosshairTimeSeriesPlot.mode.tsx` (Phase 4c).
 */

import React from 'react';

import { PlotHost } from '@/components/plots/PlotHost';
import { crosshairTimeSeriesPlot } from '@/components/plots/crosshairTimeSeriesPlot.mode';
import type { PlotMode } from '@/components/plots/plotHost.types';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

import { useActiveLayerIsFourD } from './pinnedTimeRow.helpers';

const PINNED_TIME_ROW_MODES: PlotMode[] = [crosshairTimeSeriesPlot];

export const PinnedTimeRow: React.FC = () => {
  const isFourD = useActiveLayerIsFourD();
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  const selectedLayerName = useLayerStore((state) =>
    state.selectedLayerId
      ? state.layers.find((l) => l.id === state.selectedLayerId)?.name
      : undefined,
  );
  // Select the existing world_mm tuple by reference so PlotHost's ctx memo
  // is stable across unrelated viewState updates.
  const crosshairMm = useViewStateStore((state) =>
    state.viewState.crosshair?.visible ? state.viewState.crosshair.world_mm : undefined,
  );

  if (!isFourD) {
    return null;
  }

  return (
    <div
      data-testid="pinned-time-row"
      className="bf-pinned-time-row"
      style={{ height: '100%', width: '100%' }}
    >
      <PlotHost
        modes={PINNED_TIME_ROW_MODES}
        defaultModeId="crosshair-time-series"
        layerId={selectedLayerId ?? undefined}
        layerName={selectedLayerName}
        crosshairMm={crosshairMm}
      />
    </div>
  );
};

export default PinnedTimeRow;
