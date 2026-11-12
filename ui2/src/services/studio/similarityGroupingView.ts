import type { PopulationPartition } from '@/types/population';
import type {
  RelationshipFit,
  RelationshipLinkage,
} from '@/services/studio/PopulationRelationshipService';
import { isOutlierGroup, isUnassignedGroup } from '@/services/studio/populationGroups';
import { SIMILARITY_LINKAGE_NAME } from '@/components/studio/montageModel';

/** The achromatic marks that tell similarity groups apart on the map and in the grid. */
export type SimilarityGlyphShape =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'triangle-down'
  | 'cross'
  | 'plus'
  | 'diamond-hollow';
const GROUP_SHAPES: readonly SimilarityGlyphShape[] = [
  'circle',
  'square',
  'triangle',
  'triangle-down',
  'cross',
  'plus',
];
export const OUTLIER_SHAPE: SimilarityGlyphShape = 'diamond-hollow';
export const groupShape = (index: number): SimilarityGlyphShape =>
  GROUP_SHAPES[index % GROUP_SHAPES.length];

export interface SimilarityClass {
  id: string;
  label: string;
  memberIds: readonly string[];
  shape: SimilarityGlyphShape;
  /** Members alone in their cluster: one class, never a group. */
  outliers: boolean;
}

/**
 * What the similarity strip shows about a grouping: the classes of its
 * legend (the montage's group headers, then Outliers), the backend's
 * suggestion, and the chosen cut's silhouette. Every field the backend may
 * not send is null when absent, so nothing is invented.
 *
 * Backend fields read (all from `RelationshipFit.geometry.grouping`, present
 * on grouping fits only): `linkage`, `cuts[].groups`, `cuts[].silhouette`,
 * `cuts[].assignment` and `cuts[].singletons` (used by `relationshipPartition`),
 * `bestGroups`, `clearGrouping`, `silhouetteThreshold`.
 */
export interface SimilarityGroupingView {
  linkage: RelationshipLinkage;
  /** "Ward linkage clustering" / "average-linkage clustering". */
  linkageName: string;
  classes: SimilarityClass[];
  shapeOf: ReadonlyMap<string, SimilarityGlyphShape>;
  /** Groups the backend suggests (best silhouette); null when it says nothing. */
  suggestedGroups: number | null;
  /** False: the best cut is below the silhouette threshold. Null when unknown. */
  clearGrouping: boolean | null;
  /** Mean silhouette of the cut on screen; null when unknown. */
  silhouette: number | null;
  /** The number of clusters cut (groups plus each outlier); null when ungrouped. */
  shownGroups: number | null;
}

export function similarityGroupingView(
  fit: RelationshipFit | null,
  partition: PopulationPartition | null,
): SimilarityGroupingView {
  const evidence = fit?.geometry.grouping;
  const linkage: RelationshipLinkage = evidence?.linkage ?? 'average';
  const grouping =
    partition?.origin === 'map-derived' && (!fit || partition.fitId === fit.fitId)
      ? partition
      : null;
  const classes: SimilarityClass[] = [];
  const outlierIds: string[] = [];
  let shownGroups: number | null = null;
  if (grouping) {
    let index = 0;
    for (const group of grouping.groups) {
      if (isUnassignedGroup(grouping, group)) continue;
      // A saved grouping from before outliers were reported keeps its
      // one-member groups; they read as outliers here too.
      if (isOutlierGroup(grouping, group) || group.memberIds.length === 1) {
        outlierIds.push(...group.memberIds);
        continue;
      }
      classes.push({
        id: group.id,
        label: group.value ? `Group ${group.value}` : group.label,
        memberIds: group.memberIds,
        shape: groupShape(index++),
        outliers: false,
      });
    }
    if (outlierIds.length)
      classes.push({
        id: 'outliers',
        label: 'Outliers',
        memberIds: outlierIds,
        shape: OUTLIER_SHAPE,
        outliers: true,
      });
    shownGroups = index + outlierIds.length;
  }
  const shapeOf = new Map<string, SimilarityGlyphShape>();
  for (const entry of classes) for (const id of entry.memberIds) shapeOf.set(id, entry.shape);
  const cut =
    evidence && shownGroups !== null
      ? evidence.cuts.find((candidate) => candidate.groups === shownGroups)
      : undefined;
  return {
    linkage,
    linkageName: SIMILARITY_LINKAGE_NAME[linkage],
    classes,
    shapeOf,
    suggestedGroups: evidence?.bestGroups ?? null,
    clearGrouping: evidence ? evidence.clearGrouping : null,
    silhouette: cut ? cut.silhouette : null,
    shownGroups,
  };
}

/** "Suggested: 4 groups", "No clear grouping", or null when the fit says nothing. */
export function suggestionText(view: SimilarityGroupingView): string | null {
  if (view.clearGrouping === false) return 'No clear grouping';
  return view.suggestedGroups === null
    ? null
    : `Suggested: ${view.suggestedGroups} ${view.suggestedGroups === 1 ? 'group' : 'groups'}`;
}
