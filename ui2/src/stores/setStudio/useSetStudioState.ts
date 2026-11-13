import { useRef, useSyncExternalStore } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';

type SetStudioState = ReturnType<typeof useSetStudioStore.getState>;

/**
 * Whether `next` differs from `previous` only by a hover probe that no reader
 * can see. The probe in force is `pinnedProbe ?? hoverProbe`, so while a pin
 * is held (in both states) a moving hover probe changes nothing shown; only
 * its presence is read on its own (whether hover can stand in for a pin).
 * Every other field is compared by reference, one level into `population`.
 */
export function sameSetStudioStateExceptHiddenHover(
  previous: SetStudioState,
  next: SetStudioState,
): boolean {
  if (previous === next) return true;
  const before = previous as unknown as Record<string, unknown>,
    after = next as unknown as Record<string, unknown>;
  const keys = Object.keys(after);
  if (keys.length !== Object.keys(before).length) return false;
  for (const key of keys) if (key !== 'population' && before[key] !== after[key]) return false;
  const a = previous.population,
    b = next.population;
  if (a === b) return true;
  const fields = Object.keys(b) as (keyof typeof b)[];
  if (fields.length !== Object.keys(a).length) return false;
  for (const field of fields) if (field !== 'hoverProbe' && a[field] !== b[field]) return false;
  if (a.hoverProbe === b.hoverProbe) return true;
  return !!a.pinnedProbe && !!b.pinnedProbe && !!a.hoverProbe === !!b.hoverProbe;
}

/**
 * The whole Set Studio state, for components that read it widely, without
 * re-rendering for a hover probe that moves under a pin (Follow hover writes
 * it on every voxel the pointer crosses). Anything else re-renders as
 * `useSetStudioStore()` would. Read `hoverProbe`'s position only through
 * `pinnedProbe ?? hoverProbe`; while pinned, the returned state may hold an
 * older hover position.
 */
export function useSetStudioState(): SetStudioState {
  const kept = useRef<SetStudioState | null>(null);
  const snapshot = () => {
    const next = useSetStudioStore.getState();
    const previous = kept.current;
    if (previous && sameSetStudioStateExceptHiddenHover(previous, next)) return previous;
    kept.current = next;
    return next;
  };
  return useSyncExternalStore(useSetStudioStore.subscribe, snapshot, snapshot);
}
