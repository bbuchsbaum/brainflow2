import { PopulationPlot } from './PopulationPlot';
import type { PlotMode } from './plotHost.types';
export const populationPlot: PlotMode = {
  id: 'population',
  label: 'Population',
  supports: () => ({ supported: true }),
  render: (ctx) => <PopulationPlot ctx={ctx} />,
};
