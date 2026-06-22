/**
 * cohortPlot — PlotMode binding for by-factor cohort distributions.
 *
 * Supported when a Set-Studio cohort (with sampleable members) is active and a
 * crosshair is placed; otherwise the host shows the matching empty state.
 */

import { CohortPlotBody, COHORT_MODE_ID } from "./CohortPlot";
import { getActiveCohort } from "./cohortPlot.helpers";
import type { PlotMode } from "./plotHost.types";

export const cohortPlot: PlotMode = {
  id: COHORT_MODE_ID,
  label: "Cohort",
  supports: (ctx) => {
    // Prefer the reactive ctx signal (so the tab enables the moment a cohort
    // becomes active); fall back to a direct store read otherwise.
    const cohortAvailable = ctx.hasCohort ?? getActiveCohort() !== null;
    if (!cohortAvailable) {
      return {
        supported: false,
        reason: "unsupported-layer",
        message: "Open a Set Studio cohort to plot member values by factor.",
      };
    }
    if (!ctx.crosshairMm) {
      return {
        supported: false,
        reason: "no-crosshair",
        message: "Place the crosshair to sample the cohort.",
      };
    }
    return { supported: true };
  },
  render: (ctx) => <CohortPlotBody ctx={ctx} />,
};

export default cohortPlot;
