import type {
  StudioFolderOntologyCandidate,
  StudioFolderOntologySummary,
  StudioImportCandidate,
} from '@/types/studio';
import { canImportCandidate } from './importContract';

/** The last component of a folder path: what a set opened from it is called. */
export function folderSetName(root: string): string | null {
  const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/);
  const name = parts[parts.length - 1]?.trim();
  return name ? name : null;
}

/** "35 members × 3 images". */
export function folderShapeLabel(members: number, images: number): string {
  return `${members} ${members === 1 ? 'member' : 'members'} × ${images} ${images === 1 ? 'image' : 'images'}`;
}

/**
 * The matrix in one line: its shape, then what is not as expected (or that
 * nothing is). A full matrix needs no word per cell.
 */
export function folderReviewSummary(
  members: number,
  images: number,
  missing: number,
  repeated: number,
): string {
  const shape = folderShapeLabel(members, images);
  const exceptions = [
    missing > 0 ? `${missing} missing` : null,
    repeated > 0 ? `${repeated} with more than one file` : null,
  ].filter(Boolean);
  return `${shape}, ${exceptions.length ? exceptions.join(', ') : 'none missing'}`;
}

/** Which files each member holds, whatever the members and images are called. */
function partitionKey(candidate: Pick<StudioFolderOntologyCandidate, 'groups'>): string {
  return JSON.stringify(
    candidate.groups
      .map((group) => group.bindings.map((binding) => binding.sourcePath).sort())
      .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '')),
  );
}

const complete = (candidate: StudioFolderOntologyCandidate) =>
  candidate.groups.length > 0 &&
  candidate.unmatchedFiles === 0 &&
  candidate.duplicateKeys === 0 &&
  candidate.missingRoleBindings === 0;

/** One file per member: the "one member per file" fallback, whatever it is called. */
const onePerFile = (candidate: Pick<StudioFolderOntologyCandidate, 'groups'>) =>
  candidate.groups.every((group) => group.bindings.length === 1);

/** `sub-*` folders directly under the root as the members: the conventional layout. */
const subjectFolders = (candidate: StudioFolderOntologyCandidate) =>
  candidate.strategy === 'member_folders' &&
  candidate.groups.every((group) => /^sub-[^/]+$/i.test(group.memberId));

export type FolderOpenDecision =
  { direct: true; members: number; images: number } | { direct: false; reason: string };

const review = (reason: string): FolderOpenDecision => ({ direct: false, reason });

/** Said when the study on screen holds work that opening a set would discard. */
export const HELD_WORK_REVIEW_REASON = 'The open study holds work that this set would replace.';

/** The reason as the review states it: "Shown for review: the scan limit was reached." */
export function folderReviewReasonLine(reason: string): string {
  return `Shown for review: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

/**
 * Whether a scanned folder can be opened as a set without showing its review.
 *
 * Only when there is nothing for the user to decide. The scan was complete
 * and raised no warning. The organisation is the one the scan ranks first,
 * gives every member every image exactly once and leaves no file out. And no
 * other organisation is an equally good reading of the folder.
 *
 * What counts as another reading:
 * - It is complete, or it places every file among members that hold more
 *   than one image and leaves some members short: that may be the intended
 *   reading with files missing, which is for the user to say. (A folder
 *   whose images follow the `same_item`, `same_run` naming is always also
 *   offered as "role × condition" with one file per member and every other
 *   cell missing; that is a per-file reading and does not hold up the
 *   folder.)
 * - It must divide the files among members differently. Two organisations
 *   that differ only in what they call the members and images are the same
 *   set.
 * - It is not "one member per file", under that name or any other. That
 *   reading fits every folder and is always on offer.
 * - It does not count against `sub-*` folders. When the first-ranked
 *   organisation is "one member per folder" and every member folder is named
 *   `sub-…`, that is the conventional layout and it wins over a complete
 *   alternative (subjects × sessions, say). The backend ranks it first for
 *   the same reason. Member folders with other names enjoy no such
 *   preference: there a complete alternative is a real ambiguity.
 *
 * Notes on a draft whose image headers were not read ("headers not sampled",
 * the remote inventory note) are information, not warnings, and do not force
 * a review. Anything else is shown for review, as is a draft that cannot be
 * opened at all.
 */
export function decideFolderOpen(
  summary: StudioFolderOntologySummary | null | undefined,
  candidate: StudioImportCandidate | null | undefined,
): FolderOpenDecision {
  if (!summary || !candidate) return review('The folder has not been scanned.');
  if (summary.truncated) return review('The scan limit was reached.');
  if (summary.warnings.length > 0) return review('The scan reported a warning.');
  const discovery = candidate.discovery;
  if (candidate.mode !== 'regex' || !discovery) return review('Not a folder draft.');
  const proposal = summary.candidates.find((item) => item.filePattern === discovery.filePattern);
  if (!proposal) return review('The organisation was edited.');
  if (proposal.strategy === 'flat_statmap_fallback')
    return review('No folder organisation was recognised.');
  if (proposal !== summary.candidates[0])
    return review('The organisation is not the one the scan ranks first.');
  if (proposal.warnings.length > 0) return review('The organisation carries a warning.');
  if (!complete(proposal)) return review('The proposed organisation is incomplete.');
  if (!canImportCandidate(candidate)) return review('The draft cannot be opened.');
  if (discovery.truncated) return review('The scan limit was reached.');
  if (discovery.unmatchedFiles > 0) return review('Some files match no member.');
  if (discovery.duplicateKeys > 0) return review('Some images are assigned twice.');
  const images = discovery.observedRoles;
  const groups = discovery.groups;
  if (groups.length === 0 || images.length === 0) return review('No images were found.');
  for (const group of groups) {
    if (group.missingRoles.length > 0 || group.duplicateRoles.length > 0)
      return review('A member is missing an image or has two.');
    for (const image of images)
      if (group.bindings.filter((binding) => binding.role === image).length !== 1)
        return review('A member is missing an image or has two.');
  }
  const join = candidate.set.ingestAudit.join;
  if (join.severity !== 'ok' || join.unmatchedRows > 0 || join.duplicateKeys > 0)
    return review('The file matching reported a problem.');
  if (join.issueDetails.length > 0 || candidate.set.ingestAudit.support.severity !== 'ok')
    return review('The draft carries a warning.');
  if (subjectFolders(proposal))
    return { direct: true, members: groups.length, images: images.length };
  const partition = partitionKey(proposal);
  const rival = summary.candidates.some(
    (other) =>
      other.id !== proposal.id &&
      other.strategy !== 'flat_statmap_fallback' &&
      complete(other) &&
      !onePerFile(other) &&
      partitionKey(other) !== partition,
  );
  if (rival) return review('More than one organisation fits this folder.');
  // A reading that places every file among multi-image members but leaves
  // some short of an image may be the intended one, with files missing.
  // One member per file is never such a reading: its "missing" images are
  // only the other files.
  const holed = summary.candidates.some(
    (other) =>
      other.id !== proposal.id &&
      other.strategy !== 'flat_statmap_fallback' &&
      other.groups.length > 0 &&
      other.unmatchedFiles === 0 &&
      other.missingRoleBindings > 0 &&
      !onePerFile(other) &&
      partitionKey(other) !== partition,
  );
  if (holed) return review('Another organisation of this folder has missing images.');
  return { direct: true, members: groups.length, images: images.length };
}
