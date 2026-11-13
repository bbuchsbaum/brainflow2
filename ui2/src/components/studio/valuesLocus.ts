import { useMemo } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import type { PopulationProbe } from '@/types/population';

/**
 * Where the Values dock samples: the pin, or (while nothing is pinned) the
 * pointer whenever a hover probe is in force. This is the probe controller's
 * own rule (`pinnedProbe ?? hoverProbe`), so the label and the sampled values
 * always name the same place. The hover probe exists only while Follow hover
 * is on over the Population lens: turning Follow hover off or leaving the lens
 * clears it. The Inspector labels its value with it ("Value at the pin" /
 * "Value at the pointer").
 */
export interface ValuesLocus {
  kind: 'pin' | 'pointer';
  /** World coordinates (+R, +A, +S), mm. */
  worldMm: readonly [number, number, number];
  /** Sphere radius in mm (0: the voxel). */
  radiusMm: number;
  /** The region's name when the probe is a region or cluster. */
  region: string | null;
}

type LocusInputs = {
  pinnedProbe: PopulationProbe | null | undefined;
  hoverProbe: PopulationProbe | null | undefined;
};

/** The locus the Values dock shows: the probe the controller samples (pure). */
export function valuesLocusOf({ pinnedProbe, hoverProbe }: LocusInputs): ValuesLocus | null {
  const probe = pinnedProbe ?? hoverProbe;
  if (!probe) return null;
  const kind = pinnedProbe ? 'pin' : 'pointer';
  return { kind, worldMm: probe.worldMm, radiusMm: probe.radiusMm, region: probe.region?.label ?? null };
}

/**
 * The Values dock's locus, as a hook: `{ kind: 'pin' | 'pointer', worldMm, … }`
 * or null when Values samples nowhere. Stable while the locus is unchanged.
 */
export function useValuesLocus(): ValuesLocus | null {
  const pinnedProbe = useSetStudioStore((state) => state.population.pinnedProbe);
  const hoverProbe = useSetStudioStore((state) => state.population.hoverProbe);
  const locus = valuesLocusOf({ pinnedProbe, hoverProbe });
  const key = locus ? JSON.stringify(locus) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => locus, [key]);
}
