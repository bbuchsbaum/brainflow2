import type { PopulationWorkingSelection } from '@/types/population';

/**
 * A selection the data chose (the similarity map's lasso, a similarity
 * group, a brush over the values) is exploratory: a test of it is circular.
 * It is labelled wherever A is named; it may still be tested.
 */
export const EXPLORATORY_LABEL = 'Exploratory selection';
export const EXPLORATORY_REASON = 'Chosen from the data; p-values are not valid for confirming it.';

/** The rule: a selection whose origin is the maps themselves. */
export function isExploratorySelection(working: PopulationWorkingSelection): boolean {
  return working.kind === 'members' && working.origin === 'map-derived';
}

/**
 * Subjects picked off the grid are chosen from the data when the order or
 * grouping on screen came from the maps: similarity, distance from the mean,
 * the value at the pin (all or witnesses), or similarity groups. Source,
 * ID and design-column orders and factor groups are not.
 */
export function selectionFromDataOrder(args: {
  sort: string | null;
  /** A shared similarity or value order is in force (outside the montage too). */
  savedOrder: boolean;
  responseOrder: boolean;
  partitionOrigin: 'metadata' | 'map-derived' | null;
}): boolean {
  if (args.partitionOrigin === 'map-derived') return true;
  if (args.sort !== null)
    return ['similarity', 'distance', 'crosshair', 'witnesses'].includes(args.sort);
  return args.savedOrder || args.responseOrder;
}
