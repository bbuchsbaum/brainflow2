import type { SpatialFieldSetSummary, StudioFeatureSummary } from '@/types/studio';
import { shortImageNames } from './designPanelModel';

/**
 * One map a set holds for every member ("roles" in the store and on the
 * wire; a feature in `selection.activeFeatureId`): enc_rep_rsa holds
 * same_item, same_run and temporal_dist.
 */
export interface StudioSetMap {
  /** The feature id (`selection.activeFeatureId`). */
  id: string;
  /** The feature's own label, as stored (for a folder set, its path). */
  label: string;
  /** The label without the directory and extension every map shares. */
  short: string;
  units: string | null;
}

/**
 * The maps of a set, in the order its members' bindings first name them,
 * with the primary map first. A set whose bindings name no feature has its
 * primary feature alone (when the store knows it). Features the store does
 * not describe are left out: they cannot be shown.
 */
export function studioSetMaps(
  set: Pick<SpatialFieldSetSummary, 'primaryFeatureId' | 'memberSummaries'> | null | undefined,
  features: Readonly<Record<string, StudioFeatureSummary>>,
): StudioSetMap[] {
  if (!set) return [];
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && features[id] && !ids.includes(id)) ids.push(id);
  };
  add(set.primaryFeatureId);
  for (const member of set.memberSummaries)
    for (const binding of member.bindings ?? []) add(binding.featureId);
  const short = shortImageNames(ids.map((id) => features[id].label));
  return ids.map((id) => {
    const feature = features[id];
    return {
      id,
      label: feature.label,
      short: short.get(feature.label) ?? feature.label,
      units: feature.units?.trim() || null,
    };
  });
}
