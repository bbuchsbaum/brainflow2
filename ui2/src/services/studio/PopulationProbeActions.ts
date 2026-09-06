import type { PopulationParticipantDefinition } from '@/types/population';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { resolvePopulation } from './populationContext';
import { populationSupportKey } from './PopulationProbeController';

/** UI commands share the canonical Studio selection/probe state. Sample frames
 * remain owned by the panel's controller, outside the global stores. */
export const populationProbeActions = {
  configureParticipants(definition: PopulationParticipantDefinition | null) {
    return useSetStudioStore.getState().configurePopulationParticipants(definition);
  },
  focus(id: string) {
    const state = useSetStudioStore.getState();
    if (resolvePopulation(state).context.memberIds.includes(id)) state.setActiveMember(id);
  },
  toggle(id: string) {
    const state = useSetStudioStore.getState();
    const population = resolvePopulation(state);
    if (!population.context.memberIds.includes(id)) return;
    const members = population.workingMemberIds;
    state.selectPopulationMembers(
      members.includes(id) ? members.filter((member) => member !== id) : [...members, id],
    );
  },
  selectAll() {
    useSetStudioStore.getState().selectPopulationContext();
  },
  selectNone() {
    useSetStudioStore.getState().selectPopulationMembers([]);
  },
  selectFocused() {
    const state = useSetStudioStore.getState();
    const id = state.selection.activeMemberId;
    if (id && resolvePopulation(state).context.memberIds.includes(id))
      state.selectPopulationMembers([id]);
  },
  undoSelection() {
    useSetStudioStore.getState().undoPopulationSelection();
  },
  pin(radiusMm: number, previewHover: boolean) {
    const state = useSetStudioStore.getState();
    const view = useViewStateStore.getState();
    const supportKey = populationSupportKey(state, view.activeWorkspaceKey);
    const candidate = previewHover ? state.population.hoverProbe : null;
    const hover = candidate?.supportKey === supportKey ? candidate : null;
    state.setPopulationProbe(
      {
        supportKey,
        worldMm: hover?.worldMm ?? [...view.viewState.crosshair.world_mm],
        radiusMm,
        reduce: 'mean',
      },
      'pin',
    );
  },
  unpin() {
    useSetStudioStore.getState().setPopulationProbe(null, 'pin');
  },
  setRadius(radiusMm: number) {
    if (!Number.isFinite(radiusMm) || radiusMm < 0) return;
    const state = useSetStudioStore.getState();
    if (state.population.pinnedProbe)
      state.setPopulationProbe({ ...state.population.pinnedProbe, radiusMm }, 'pin');
    else if (state.population.hoverProbe)
      state.setPopulationProbe({ ...state.population.hoverProbe, radiusMm }, 'hover');
  },
  /** The caller owns and disposes this subscription when its panel changes. */
  followHover(radiusMm: number, workspaceId: string) {
    return useMouseCoordinateStore.subscribe((mouse) => {
      if (!mouse.worldCoordinates || !mouse.activeView) return;
      if (useViewStateStore.getState().activeWorkspaceKey !== workspaceId) return;
      const state = useSetStudioStore.getState();
      state.setPopulationProbe(
        {
          supportKey: populationSupportKey(state, workspaceId),
          worldMm: [...mouse.worldCoordinates],
          radiusMm,
          reduce: 'mean',
        },
        'hover',
      );
    });
  },
};
