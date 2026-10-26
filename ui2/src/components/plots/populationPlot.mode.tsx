import { PopulationPlot } from './PopulationPlot';
import type { PlotMode } from './plotHost.types';
export const populationPlot: PlotMode = {
  id: 'population',
  label: 'Population',
  // Offered once a Studio population exists (no empty "Population" tab).
  supports: (ctx) =>
    ctx.hasPopulation === false
      ? { supported: false, reason: 'no-layer', message: 'Open a dataset in Studio to plot its population.' }
      : { supported: true },
  render: (ctx) => <PopulationPlot ctx={ctx} />,
};
