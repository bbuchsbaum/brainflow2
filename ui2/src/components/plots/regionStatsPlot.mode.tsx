/**
 * regionStatsPlot — PlotMode binding for the atlas region × statistic plot.
 *
 * Supported when the active layer is a scalar map AND an atlas (label) layer is
 * loaded to define the regions; otherwise the host shows the matching empty
 * state.
 */

import { RegionStatsPlotBody, REGION_STATS_MODE_ID } from "./RegionStatsPlot";
import { findAtlasLayerId, isAtlasLayer } from "./regionStatsPlot.helpers";
import type { PlotMode } from "./plotHost.types";

export const regionStatsPlot: PlotMode = {
  id: REGION_STATS_MODE_ID,
  label: "Regions",
  supports: (ctx) => {
    if (!ctx.layerId) {
      return {
        supported: false,
        reason: "no-layer",
        message: "Select a scalar layer to plot region statistics.",
      };
    }
    if (isAtlasLayer(ctx.layerId)) {
      return {
        supported: false,
        reason: "unsupported-layer",
        message: "Select a non-atlas (scalar) layer to reduce over regions.",
      };
    }
    // Prefer the reactive ctx signal (so the tab enables the moment an atlas
    // loads); fall back to a direct store read for callers that don't supply it.
    const atlasLayerId = ctx.atlasLayerId ?? findAtlasLayerId();
    if (!atlasLayerId) {
      return {
        supported: false,
        reason: "unsupported-layer",
        message: "Load an atlas layer to plot region statistics.",
      };
    }
    return { supported: true };
  },
  render: (ctx) => <RegionStatsPlotBody ctx={ctx} />,
};

export default regionStatsPlot;
