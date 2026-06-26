/**
 * PlotPanel — call-site migration to the Phase 4 plot host.
 *
 * The panel is a thin shell that wires the active layer + crosshair from the
 * application stores into a `PlotHost` with the registered histogram and
 * crosshair time-series plot modes. All histogram-specific logic lives in
 * `HistogramPlotBody` (Phase 4b); time-series sampling lives in
 * `CrosshairTimeSeriesPlotBody` (Phase 4c).
 *
 * Mode selection is owned by `usePlotModeSelection`
 * (mote `bd-01KQK24YYRXCDJKAPE6SBB84JE`), which:
 *   - initializes the store with the active-layer-derived default
 *     (`auto` source) on first mount;
 *   - re-derives on layer change while the source is still `auto`;
 *   - preserves a manual pick (`user` source) across layer changes for as
 *     long as the chosen mode is supported, and transiently falls back to
 *     the first supported mode otherwise.
 *
 * The `defaultMode` prop is retained for backward compatibility with
 * pre-policy callers — when the resolver yields no mode (no layer + an
 * empty mode list), the host falls back to it. With the standard mode list
 * the resolver always returns a value.
 */

import React from 'react';

import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { PlotHost } from '@/components/plots/PlotHost';
import { histogramPlot } from '@/components/plots/histogramPlot.mode';
import { crosshairTimeSeriesPlot } from '@/components/plots/crosshairTimeSeriesPlot.mode';
import { regionStatsPlot } from '@/components/plots/regionStatsPlot.mode';
import { cohortPlot } from '@/components/plots/cohortPlot.mode';
import { useAtlasLayerId } from '@/components/plots/regionStatsPlot.helpers';
import { useActiveCohort } from '@/components/plots/cohortPlot.helpers';
import { usePlotModeSelection } from '@/components/plots/plotMode.helpers';
import type { PlotMode, PlotModeContext } from '@/components/plots/plotHost.types';

import { PanelErrorBoundary } from '../common/PanelErrorBoundary';

const DEFAULT_PLOT_MODES: PlotMode[] = [
  histogramPlot,
  crosshairTimeSeriesPlot,
  regionStatsPlot,
  cohortPlot,
];

export interface PlotPanelProps {
  /** Fallback mode id when the resolver yields nothing (rare with the standard mode list). */
  defaultMode?: string;
  /** Override the registered modes (mainly for tests/integration variants). */
  modes?: PlotMode[];
}

const PlotPanelContent: React.FC<PlotPanelProps> = ({
  defaultMode = 'histogram',
  modes = DEFAULT_PLOT_MODES,
}) => {
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

  // Reactive availability signals so the Region/Cohort tabs enable as soon as
  // an atlas / cohort loads (their supports() gates read these from ctx rather
  // than non-reactively from the stores).
  const atlasLayerId = useAtlasLayerId();
  const hasCohort = useActiveCohort() !== null;

  // Build the same ctx the host will see. `supports()` checks in the policy
  // never read `width`/`height`, so passing 0 here is fine — the actual
  // plot-body sizing happens inside PlotHost via ResizeObserver.
  const layerCtx: PlotModeContext = React.useMemo(
    () => ({
      layerId: selectedLayerId ?? undefined,
      layerName: selectedLayerName,
      crosshairMm,
      atlasLayerId,
      hasCohort,
      width: 0,
      height: 0,
    }),
    [selectedLayerId, selectedLayerName, crosshairMm, atlasLayerId, hasCohort],
  );

  // Context-sensitive tabs: only surface modes the active data/view actually
  // affords (e.g. a 3D volume offers no Time Series, an unparcellated volume no
  // Regions). Each mode's supports() reads the affordance signals in layerCtx.
  const availableModes = React.useMemo(
    () => modes.filter((m) => m.supports(layerCtx).supported),
    [modes, layerCtx],
  );

  const { modeId, onModeChange } = usePlotModeSelection({
    modes: availableModes,
    layerCtx,
  });

  return (
    <PlotHost
      modes={availableModes}
      modeId={modeId ?? undefined}
      defaultModeId={defaultMode}
      onModeChange={onModeChange}
      layerId={selectedLayerId ?? undefined}
      layerName={selectedLayerName}
      crosshairMm={crosshairMm}
      atlasLayerId={atlasLayerId}
      hasCohort={hasCohort}
    />
  );
};

export const PlotPanel: React.FC<PlotPanelProps> = (props) => {
  return (
    <PanelErrorBoundary panelName="PlotPanel">
      <PlotPanelContent {...props} />
    </PanelErrorBoundary>
  );
};

export default PlotPanel;
