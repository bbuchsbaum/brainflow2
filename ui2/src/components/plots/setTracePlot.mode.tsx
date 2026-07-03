/**
 * setTracePlot — PlotMode binding for the cross-set trace (line + CI band).
 *
 * Supported under the same conditions as the cohort box plot: a Set-Studio
 * cohort with sampleable members is active and a crosshair is placed. The
 * toolbar adds a dispersion-band selector (the reducer / sphere radius live in
 * the shared encoding panel).
 */

import { SetTracePlotBody } from './SetTracePlot';
import { SET_TRACE_MODE_ID } from './setTracePlot.helpers';
import { BandToolbar } from './setTracePlot.toolbar';
import { getActiveCohort } from './cohortPlot.helpers';
import type { PlotMode } from './plotHost.types';

export const setTracePlot: PlotMode = {
  id: SET_TRACE_MODE_ID,
  label: 'Trace',
  supports: (ctx) => {
    const cohortAvailable = ctx.hasCohort ?? getActiveCohort() !== null;
    if (!cohortAvailable) {
      return {
        supported: false,
        reason: 'unsupported-layer',
        message: 'Open a Set Studio cohort to trace member values with a band.',
      };
    }
    if (!ctx.crosshairMm) {
      return {
        supported: false,
        reason: 'no-crosshair',
        message: 'Place the crosshair to sample the cohort trace.',
      };
    }
    return { supported: true };
  },
  render: (ctx) => <SetTracePlotBody ctx={ctx} />,
  toolbar: () => <BandToolbar />,
};

export default setTracePlot;
