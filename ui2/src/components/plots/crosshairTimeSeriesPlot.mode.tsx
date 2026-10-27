/**
 * The Plot dock's "Series" mode (phase 4 E5; was "Time series", Phase 4c).
 *
 * One series mode over two sources:
 * - the active 4D layer at the crosshair (point or sphere; `sample_stack`),
 *   clicking a point moves to that frame;
 * - the active Set Studio dataset with a lag / time axis (FIR estimates per
 *   subject × condition × lag, 3D members or 4D members), one line per
 *   condition with a population band, at the crosshair.
 * The mode id stays `crosshair-time-series` so saved selections and the
 * pinned time row keep working.
 */

import { TIME_SERIES_MODE_ID } from "./CrosshairTimeSeriesPlot";
import { isLayerFourD } from "./crosshairTimeSeriesPlot.helpers";
import { SeriesBody } from "./SeriesBody";
import { SeriesSourceToggle } from "./SeriesSourceToggle";
import { hasSetSeries } from "./seriesSource.helpers";
import type { PlotMode } from "./plotHost.types";

export const crosshairTimeSeriesPlot: PlotMode = {
  id: TIME_SERIES_MODE_ID,
  label: "Series",
  supports: (ctx) => {
    const set = hasSetSeries();
    if (!ctx.crosshairMm) {
      return {
        supported: false,
        reason: "no-crosshair",
        message: "Place the crosshair to sample a series.",
      };
    }
    if (set) return { supported: true };
    if (!ctx.layerId) {
      return {
        supported: false,
        reason: "no-layer",
        message: "Select a 4D layer, or open a dataset with a lag or time axis, to plot a series.",
      };
    }
    if (!isLayerFourD(ctx.layerId)) {
      return {
        supported: false,
        reason: "unsupported-layer",
        message: "Series need a 4D layer, or a dataset with a lag or time axis.",
      };
    }
    return { supported: true };
  },
  render: (ctx) => <SeriesBody ctx={ctx} />,
  toolbar: (ctx) => <SeriesSourceToggle layerId={ctx.layerId} />,
  // The mode selector and source switch sit on the series' own first toolbar row.
  inlineChrome: true,
};

export default crosshairTimeSeriesPlot;
