import { useEffect } from 'react';
import { useStudioWorkspaceKey } from '@/hooks/useStudioWorkspace';
import { useSetStudioStore } from '@/stores/setStudioStore';
import {
  buildPopulationProbeQuery,
  type PopulationProbeController,
} from '@/services/studio/PopulationProbeController';

type StudioState = ReturnType<typeof useSetStudioStore.getState>;

/** What a probe query is built from: a write that changes none of these changes nothing. */
export function probeQueryInputs(state: StudioState): readonly unknown[] {
  return [
    state.sets,
    state.cohorts,
    state.activeDesignFilters,
    state.selection.activeSetId,
    state.selection.activeFeatureId,
    state.selection.activeScopeCohortId,
    state.population.pinnedProbe,
    state.population.hoverProbe,
    state.population.mask,
    state.population.sessionRevision,
  ];
}
const sameInputs = (a: readonly unknown[] | null, b: readonly unknown[]) =>
  !!a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Drivers holding each controller: it samples while any holds it. */
const holders = new Map<PopulationProbeController, number>();
function hold(controller: PopulationProbeController): () => void {
  const count = holders.get(controller) ?? 0;
  holders.set(controller, count + 1);
  // A controller another driver stopped is started again by the next holder.
  if (count === 0 || !controller.isActive()) controller.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holders.get(controller) ?? 1) - 1;
    if (left > 0) holders.set(controller, left);
    else {
      holders.delete(controller);
      controller.stop();
    }
  };
}

/**
 * Drive a probe controller from the Studio's population state, outside React
 * renders: a store subscription rebuilds the query only when what it is
 * built from changes, so a hover or focus write re-renders nothing here. It
 * samples whatever is pinned (or hovered) whether or not the Values tab is
 * the one showing. With `populationOnly`, it drives only while the Population
 * lens is in front (Deck and Compare sample nothing).
 */
export function usePopulationProbeDriver(
  controller: PopulationProbeController,
  enabled = true,
  { populationOnly = false }: { populationOnly?: boolean } = {},
) {
  const workspaceId = useStudioWorkspaceKey();
  const inPopulation = useSetStudioStore((state) => state.selection.activeLens === 'population');
  const active = enabled && (!populationOnly || inPopulation);
  useEffect(() => {
    if (!active) return;
    const release = hold(controller);
    let last: readonly unknown[] | null = null;
    const push = (state: StudioState) => {
      const inputs = probeQueryInputs(state);
      if (sameInputs(last, inputs)) return;
      last = inputs;
      controller.request(buildPopulationProbeQuery(state, workspaceId).query);
    };
    push(useSetStudioStore.getState());
    const unsubscribe = useSetStudioStore.subscribe(push);
    return () => {
      unsubscribe();
      release();
    };
  }, [controller, active, workspaceId]);
}
