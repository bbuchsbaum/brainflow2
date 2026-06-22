/**
 * crosshairTimeSeriesPlot — Phase 4c PlotMode binding.
 *
 * Wraps `CrosshairTimeSeriesPlotBody` and exposes the static gates
 * (`no-layer`, `no-crosshair`, `unsupported-layer`) through the host's
 * empty-state machine. The dynamic gate (out-of-bounds voxel) is handled
 * by `resolveTimeseriesVoxel` inside the body — those are transient
 * invalid samples that should not change the host state.
 */

import {
  CrosshairTimeSeriesPlotBody,
  TIME_SERIES_MODE_ID,
} from "./CrosshairTimeSeriesPlot";
import { isLayerFourD } from "./crosshairTimeSeriesPlot.helpers";
import type { PlotMode } from "./plotHost.types";

export const crosshairTimeSeriesPlot: PlotMode = {
  id: TIME_SERIES_MODE_ID,
  label: "Time Series",
  supports: (ctx) => {
    if (!ctx.layerId) {
      return {
        supported: false,
        reason: "no-layer",
        message: "Select a 4D layer to plot a voxel time series.",
      };
    }
    if (!isLayerFourD(ctx.layerId)) {
      return {
        supported: false,
        reason: "unsupported-layer",
        message: "Time series requires a 4D volume layer.",
      };
    }
    if (!ctx.crosshairMm) {
      return {
        supported: false,
        reason: "no-crosshair",
        message: "Place the crosshair in the volume to sample a time series.",
      };
    }
    return { supported: true };
  },
  render: (ctx) => <CrosshairTimeSeriesPlotBody ctx={ctx} />,
};

export default crosshairTimeSeriesPlot;
