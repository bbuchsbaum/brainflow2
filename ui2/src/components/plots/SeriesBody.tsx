/**
 * The Series mode body (phase 4 E5): the active 4D layer's series, or the
 * active dataset's lag / time series (seriesSource.helpers.ts decides).
 */
import { CrosshairTimeSeriesPlotBody } from "./CrosshairTimeSeriesPlot";
import { SetSeriesPlot } from "./SetSeriesPlot";
import { useSeriesSource } from "./seriesSource.helpers";
import type { PlotModeContext } from "./plotHost.types";

export function SeriesBody({ ctx }: { ctx: PlotModeContext }) {
  const { source } = useSeriesSource(ctx.layerId);
  if (source === "set") return <SetSeriesPlot ctx={ctx} />;
  return <CrosshairTimeSeriesPlotBody ctx={ctx} />;
}
