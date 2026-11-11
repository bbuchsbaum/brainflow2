import type { SpatialFieldSetSummary, StudioGridCheckState } from '@/types/studio';
import { isSetCompareReady, setImportReadiness } from './importContract';
import { populationReadinessIssue } from './populationReadiness';

/**
 * Whether a lens that reads every member together (Population, Compare) can
 * read the active set, in one vocabulary for both lenses.
 *
 * - `ready`: nothing to say.
 * - `checking`: the image headers are being read. Nothing is wrong.
 * - `needs-check`: the headers were never read and no check is running (the
 *   user cancelled it). The action starts one.
 * - `check-failed`: a check ran and could not read the headers, or was
 *   stopped before it had read them all. Retry (or Continue) may help.
 * - `unavailable`: the set cannot be read together (different grids, file
 *   problems, not volume data). No action here helps.
 *
 * Only `check-failed` and `unavailable` are problems; neither is an error of
 * the app, so neither is drawn as one.
 */
export type StudioReadinessPhase =
  | 'ready'
  | 'checking'
  | 'needs-check'
  | 'check-failed'
  | 'unavailable';

export interface StudioReadiness {
  phase: StudioReadinessPhase;
  /** One line that names the state ("Checking image grids…"). */
  title: string;
  /** What is happening or needed, in a sentence or two. Empty when ready. */
  detail: string;
  /** Enough for a small pane. Empty when ready. */
  short: string;
  /**
   * `continue`: a check that was stopped part-way and picks up where it
   * stopped (the same request as `retry`; only the wording differs).
   */
  action: 'cancel' | 'check' | 'retry' | 'continue' | null;
  /**
   * The check failed because the remote connection dropped: a path on that
   * mount. The notice offers Reconnect, and the check runs again when the
   * mount is back.
   */
  reconnectPath?: string;
}

const READY: StudioReadiness = { phase: 'ready', title: '', detail: '', short: '', action: null };

export type StudioReadinessLens = 'population' | 'compare';

const LENS_NAME: Record<StudioReadinessLens, string> = {
  population: 'Population',
  compare: 'Compare',
};

/**
 * A set opened from a folder whose image headers were never read: the one
 * state the automatic check exists for. A review that already read them
 * (whatever it found) is not this.
 */
export function setNeedsGridCheck(set: SpatialFieldSetSummary | null | undefined): boolean {
  if (!set?.discoveryRequest || set.savedPopulation || set.supportKind !== 'volume') return false;
  if (setImportReadiness(set) === 'compare_ready') return false;
  const support = set.ingestAudit?.support ?? null;
  const alignment = support?.alignmentClass ?? set.alignmentClass ?? 'unknown';
  return alignment === 'unknown' && (!support || support.severity === 'ok');
}

/** Why Compare cannot average a set that Population's rule says nothing about. */
function compareIssue(set: SpatialFieldSetSummary): string {
  const alignment = set.ingestAudit?.support?.alignmentClass ?? set.alignmentClass ?? 'unknown';
  if (alignment === 'mixed') return 'These images are on different grids, so they cannot be averaged.';
  const join = set.ingestAudit?.join ?? null;
  if (join && (join.unmatchedRows > 0 || join.duplicateKeys > 0 || join.severity !== 'ok'))
    return 'Some members have missing, duplicate or unmatched images, so the set cannot be averaged.';
  return 'These images were not confirmed to be on one grid, so they cannot be averaged.';
}

export function studioReadiness(
  set: SpatialFieldSetSummary | null | undefined,
  gridCheck: StudioGridCheckState,
  lens: StudioReadinessLens,
): StudioReadiness {
  if (!set) return READY;
  const issue = populationReadinessIssue(set);
  const ready = lens === 'population' ? issue === null : isSetCompareReady(set);
  if (ready) return READY;
  const name = LENS_NAME[lens];
  // Grids nobody has read, or that a review could not read: a check answers it.
  const checkable =
    !!set.discoveryRequest &&
    set.supportKind === 'volume' &&
    (issue?.kind === 'unchecked' || issue?.kind === 'check-failed');
  if (checkable && gridCheck.status === 'checking')
    return {
      phase: 'checking',
      title: 'Checking image grids…',
      detail: `Reading each image header to confirm the images share one grid. ${name} opens by itself when this finishes; no image is downloaded.`,
      short: 'Image grids are being checked…',
      action: 'cancel',
    };
  if (checkable && gridCheck.status === 'failed' && gridCheck.resumable)
    return {
      phase: 'check-failed',
      title: 'The image grid check is not finished',
      detail: gridCheck.message ?? 'The check was stopped before every image header was read.',
      short: 'The image grid check is not finished.',
      action: 'continue',
    };
  if (checkable && gridCheck.status === 'failed')
    return {
      phase: 'check-failed',
      title: 'The image grids could not be checked',
      detail: gridCheck.message ?? 'The image headers could not be read.',
      short: 'The image grids could not be checked.',
      action: 'retry',
      ...(gridCheck.connectionLostPath ? { reconnectPath: gridCheck.connectionLostPath } : {}),
    };
  if (checkable && issue?.kind === 'check-failed')
    return {
      phase: 'check-failed',
      title: 'The image grids could not be checked',
      detail: issue.message,
      short: 'The image grids could not be checked.',
      action: 'retry',
    };
  if (checkable)
    return {
      phase: 'needs-check',
      title: 'Image grids not checked',
      detail: `${name} reads every member together, so all images must be on one grid. The image grids in this set have not been checked yet.`,
      short: 'Image grids have not been checked yet.',
      action: 'check',
    };
  const detail = lens === 'population' && issue ? issue.message : compareIssue(set);
  return {
    phase: 'unavailable',
    title: `${name} is not available for this set`,
    detail,
    short: detail,
    action: null,
  };
}
