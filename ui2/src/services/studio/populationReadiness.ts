import type { SpatialFieldSetSummary } from '@/types/studio';
import { setImportReadiness } from './importContract';

/** Why Population cannot read a set, in the user's terms, and what would help. */
export type PopulationReadinessKind =
  /** Not volume images. */
  | 'not-volume'
  /** The image headers were never read. */
  | 'unchecked'
  /** The headers were asked for and could not all be read. */
  | 'check-failed'
  | 'different-grids'
  | 'file-problems'
  | 'unconfirmed';

export interface PopulationReadinessIssue {
  kind: PopulationReadinessKind;
  message: string;
  /** The grids can be checked now, in place (see SetIngestionService.checkActiveSetGrids). */
  canCheckGrids: boolean;
}

const NEEDS_ONE_GRID =
  'Population reads every member at the same location, so all images must be on one grid.';

/**
 * What to do about grids nobody checked, for a set with no kept folder
 * discovery. Each kind of import learns the grid differently
 * (field_table/src/preview): a folder reads headers only when asked to; a
 * table import reads every listed image, so the grid is unknown only when
 * none could be read; a manifest's grid is what the manifest declares, and
 * its images are not read. "Check image grids before opening" exists only
 * in the folder review.
 */
function uncheckedGridsAdvice(provenance: string | null | undefined): string {
  if (provenance === 'regex_discovery')
    return 'The image grids in this set have not been checked. Open the set again from its folder with “Check image grids before opening” turned on.';
  if (provenance === 'manifest')
    return 'The manifest this set was opened from does not declare one grid for its images. Declare the grid in the manifest, then open the manifest again.';
  if (provenance === 'table')
    return 'No image listed in this table could be read to find its grid. Check the file paths in the table, then import it again.';
  return 'The image grids in this set have not been checked.';
}

/**
 * Null when Population may read the set. Otherwise the one cause that
 * applies, read from the import audit: the kind of data, grids never
 * checked, a check that failed, grids that differ, or files that did not
 * match. Local and remote folders are checked the same way: every header.
 */
export function populationReadinessIssue(
  set: SpatialFieldSetSummary | null,
): PopulationReadinessIssue | null {
  if (!set) return null;
  if (set.supportKind !== 'volume')
    return {
      kind: 'not-volume',
      message: `Population works on volume images only. This set holds ${set.supportKind} data; use Deck or Compare instead.`,
      canCheckGrids: false,
    };
  if (set.savedPopulation || setImportReadiness(set) === 'compare_ready') return null;

  const request = set.discoveryRequest ?? null;
  const support = set.ingestAudit?.support ?? null;
  const join = set.ingestAudit?.join ?? null;
  const issues = join?.issueDetails ?? [];
  // Support findings are reported after the file-matching ones.
  const detail = issues[issues.length - 1]?.message?.trim();
  const alignment = support?.alignmentClass ?? set.alignmentClass ?? 'unknown';

  if (alignment === 'mixed')
    return {
      kind: 'different-grids',
      message: `${NEEDS_ONE_GRID} ${detail ?? 'The images in this set are on different grids.'} Resample the images to one grid, then open the set again.`,
      canCheckGrids: false,
    };

  if (alignment === 'unknown') {
    if (support && support.severity !== 'ok')
      return {
        kind: 'check-failed',
        message: `${NEEDS_ONE_GRID} The image grids could not be checked${detail ? `: ${detail}` : '.'}`,
        canCheckGrids: !!request,
      };
    return {
      kind: 'unchecked',
      message: request
        ? `${NEEDS_ONE_GRID} The image grids in this set have not been checked yet. Choose Check image grids to read the image headers.`
        : `${NEEDS_ONE_GRID} ${uncheckedGridsAdvice(set.importContract?.provenanceKind)}`,
      canCheckGrids: !!request,
    };
  }

  if (
    alignment === 'same-grid' &&
    join &&
    (join.unmatchedRows > 0 || join.duplicateKeys > 0 || join.severity !== 'ok')
  )
    return {
      kind: 'file-problems',
      message: `The image grids match, but the set has file problems${issues[0]?.message ? `: ${issues[0].message.trim()}` : ' (unmatched, duplicate or missing images).'} Fix them, or narrow the filename matching, then open the set again.`,
      canCheckGrids: false,
    };

  const reason = set.importContract?.reason?.trim();
  return {
    kind: 'unconfirmed',
    message: `${NEEDS_ONE_GRID} This set was not confirmed to be on one grid${reason ? `: ${reason}` : '.'}`,
    canCheckGrids: false,
  };
}
