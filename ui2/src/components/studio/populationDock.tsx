import { lazy, Suspense } from 'react';
import type { DockExtraTab } from '@/components/layout/bottomWorkbenchDock.constants';
import { usePopulationViewStore } from '@/stores/populationViewStore';

/** The dock's ID for the Values tab. */
export const POPULATION_VALUES_TAB = 'population-values';

// Loaded with the tab: the router stays light.
const PopulationValuesTab = lazy(() => import('./PopulationValuesTab'));

/** The Set studio dock's own tabs: Values first (the centre drives the sampling). */
export const SET_STUDIO_DOCK_TABS: readonly DockExtraTab[] = [
  {
    id: POPULATION_VALUES_TAB,
    title: 'Values',
    leading: true,
    // The dock sizes to the tab: one line when empty, the strip when filled.
    autoHeight: {
      subscribe: (onChange) => usePopulationViewStore.subscribe(onChange),
      getSnapshot: () => usePopulationViewStore.getState().valuesDockHeight,
    },
    content: (
      <Suspense fallback={null}>
        <PopulationValuesTab />
      </Suspense>
    ),
  },
];
