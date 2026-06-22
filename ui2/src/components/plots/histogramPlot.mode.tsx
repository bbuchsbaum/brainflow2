/**
 * histogramPlot — Phase 4b PlotMode binding.
 *
 * Wraps `HistogramPlotBody` as a registered `PlotMode` so the host can render
 * histograms behind the plot-mode boundary established in Phase 4a. See
 * `./plotHost.types.ts` for the contract.
 */

import { HistogramPlotBody, HISTOGRAM_MODE_ID } from "./HistogramPlot";
import type { PlotMode } from "./plotHost.types";

export const histogramPlot: PlotMode = {
  id: HISTOGRAM_MODE_ID,
  label: "Histogram",
  supports: (ctx) =>
    ctx.layerId
      ? { supported: true }
      : {
          supported: false,
          reason: "no-layer",
          message: "Select a layer to plot a histogram.",
        },
  render: (ctx) => <HistogramPlotBody ctx={ctx} />,
};

export default histogramPlot;
