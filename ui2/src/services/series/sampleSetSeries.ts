/**
 * Sample a Set Studio dataset as a series at a locus (phase 4 E5): the
 * audited population source (buildPopulationSource), its design values,
 * the series binding (seriesBinding.ts) and one `set` sampling request
 * (sample_set_at_world, one value per member — or per member × frame for
 * 4D members). The result is a tidy frame, one row per sampled observation,
 * ready for composePopulationPlot.
 */
import type { RegionLocus } from '@brainflow/api';
import type { SampleFrame } from '@/plotting';
import { sampleProvider } from '@/services/SampleProvider';
import { buildPopulationSource } from '@/services/studio/PopulationProbeController';
import { studioMetadata } from '@/services/studio/studioMetadata';
import type { PopulationContextHost } from '@/services/studio/populationContext';
import type { PopulationState } from '@/types/population';
import {
  expandSeriesMembers,
  resolveSetSeriesBinding,
  withSeriesPositions,
  type SetSeriesBinding,
} from './seriesBinding';

type StudioHost = PopulationContextHost & { readonly population: PopulationState };

/** The active dataset's series binding, or null (no dataset / no axis). */
export function activeSetSeriesBinding(state: StudioHost): SetSeriesBinding | null {
  const set = state.selection.activeSetId ? state.sets[state.selection.activeSetId] : null;
  if (!set || set.supportKind !== 'volume') return null;
  const metadata = studioMetadata(set);
  if (metadata.issue) return null;
  return resolveSetSeriesBinding(set, metadata, state.population.participants ?? null);
}

export interface SetSeriesLocus {
  worldMm: readonly [number, number, number];
  /** 0: the nearest voxel; > 0: a sphere, voxels reduced by `reduce`. */
  radiusMm: number;
  reduce: 'mean' | 'median';
  /** A region (parcel, label region, cluster) instead of the point / sphere. */
  region?: RegionLocus | null;
  /** How the region reads in captions ("L_sensorimotor", "cluster 1"). */
  regionLabel?: string | null;
}

export async function sampleSetSeries(
  state: StudioHost,
  workspaceKey: string,
  locus: SetSeriesLocus,
  signal: AbortSignal,
  sample = sampleProvider.sample.bind(sampleProvider),
): Promise<{ frame: SampleFrame; binding: SetSeriesBinding }> {
  const binding = activeSetSeriesBinding(state);
  if (!binding) throw new Error('The dataset declares no lag or time axis.');
  const resolved = buildPopulationSource(state, workspaceKey);
  if (!resolved.source) throw new Error(resolved.issue ?? 'The dataset has no sampleable population.');
  const set = state.sets[binding.setId];
  const metadata = studioMetadata(
    set,
    resolved.source.members.map((m) => m.memberId),
  );
  if (metadata.issue) throw new Error(metadata.issue);
  const labeled = resolved.source.members.map((m) => ({
    ...m,
    designValues: metadata.columns.map((column) => ({
      column,
      value: metadata.rows.get(m.memberId)![column],
    })),
  }));
  const { members, positions } = expandSeriesMembers(binding, labeled);
  const frame = await sample(
    {
      datasetId: set.id,
      reduce: locus.reduce,
      locus: {
        kind: 'set',
        members,
        worldMm: [locus.worldMm[0], locus.worldMm[1], locus.worldMm[2]],
        radiusMm: locus.radiusMm,
        ...(resolved.source.mask ? { mask: resolved.source.mask } : {}),
        ...(locus.region ? { region: locus.region } : {}),
      },
    },
    signal,
  );
  signal.throwIfAborted();
  const positioned = withSeriesPositions(frame, positions, binding);
  return {
    frame: {
      ...positioned,
      meta: {
        ...positioned.meta,
        locus: { kind: locus.region ? 'region' : locus.radiusMm > 0 ? 'sphere' : 'point', ...locus },
      },
    },
    binding,
  };
}
