import {
  studioReadiness,
  type StudioReadiness,
  type StudioReadinessLens,
} from '@/services/studio/studioReadiness';
import { useSetStudioStore } from '@/stores/setStudioStore';

/** The active set's readiness for a lens, with the live grid check. */
export function useStudioReadiness(lens: StudioReadinessLens): StudioReadiness {
  const activeSet = useSetStudioStore((state) =>
    state.selection.activeSetId ? (state.sets[state.selection.activeSetId] ?? null) : null,
  );
  const gridCheck = useSetStudioStore((state) => state.gridCheck);
  return studioReadiness(activeSet, gridCheck, lens);
}
