import { describe, expect, it } from 'vitest';
import type { StudioFolderOntologySummary, StudioImportCandidate } from '@/types/studio';
import {
  decideFolderOpen,
  folderReviewReasonLine,
  folderSetName,
  folderShapeLabel,
} from '../folderOpenDecision';
import encRepRsaScan from './fixtures/encRepRsaScan.json';
import {
  FOLDER_IMAGES,
  FOLDER_MEMBERS,
  flatFallback,
  folderCandidate,
  folderGroups,
  folderProposal,
  folderSummary,
} from './studioFixtures';

describe('decideFolderOpen', () => {
  it('opens a complete, unambiguous folder directly', () => {
    expect(decideFolderOpen(folderSummary(), folderCandidate())).toEqual({
      direct: true,
      members: 3,
      images: 3,
    });
  });

  it('does not count the one-member-per-file fallback as a second organisation', () => {
    // Every folder is offered the fallback; it never forces a review.
    const summary = folderSummary([folderProposal(), flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate()).direct).toBe(true);
  });

  it('treats an organisation that only renames members and images as the same set', () => {
    const renamed = folderProposal({
      id: 'maps-basename-roles',
      strategy: 'path_subject_maps_basename_role',
      filePattern: 'other',
      observedRoles: ['same_item', 'same_cat', 'diff_cat'],
      groups: folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES).map((group) => ({
        ...group,
        memberId: group.memberId.replace('sub-', ''),
      })),
    });
    const summary = folderSummary([folderProposal(), renamed, flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate()).direct).toBe(true);
  });

  it('reviews when a member is missing an image', () => {
    const groups = folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES);
    groups[1] = { ...groups[1], bindings: groups[1].bindings.slice(0, 2) };
    const summary = folderSummary([
      folderProposal({ groups, missingRoleBindings: 0 }),
      flatFallback(),
    ]);
    const decision = decideFolderOpen(summary, folderCandidate({ groups }));
    expect(decision).toEqual({ direct: false, reason: 'A member is missing an image or has two.' });
  });

  it('reviews when files match no member', () => {
    const decision = decideFolderOpen(folderSummary(), folderCandidate({ unmatchedFiles: 2 }));
    expect(decision.direct).toBe(false);
  });

  it('reviews when the scan was cut short or warned', () => {
    expect(
      decideFolderOpen(folderSummary(undefined, { truncated: true }), folderCandidate()).direct,
    ).toBe(false);
    expect(
      decideFolderOpen(
        folderSummary(undefined, {
          warnings: [{ code: 'x', message: 'Some folders could not be listed.', paths: [] }],
        }),
        folderCandidate(),
      ).direct,
    ).toBe(false);
  });

  // Member folders that are not `sub-*`: no reading is the conventional one.
  const SITES = ['site-a', 'site-b', 'site-c'];
  const sites = () => folderGroups(SITES, FOLDER_IMAGES);
  /** The same nine files as one member per image kind, complete. */
  const byImage = (members: string[]) =>
    folderProposal({
      id: 'by-image',
      strategy: 'path_role_condition',
      score: 0.9,
      filePattern: 'by-image',
      groups: FOLDER_IMAGES.map((image) => ({
        memberId: image,
        designValues: [],
        bindings: members.map((member) => ({
          role: member,
          sourcePath: `/cache/mount-a/pcmri/derivatives/enc_rep_rsa/${member}/${image}`,
          relativePath: `${member}/${image}`,
          confidence: 0,
        })),
        missingRoles: [],
        duplicateRoles: [],
        confidence: 1,
      })) as never,
    });

  it('reviews when a second complete organisation divides the files differently', () => {
    const decision = decideFolderOpen(
      folderSummary([folderProposal({ groups: sites() }), byImage(SITES), flatFallback()]),
      folderCandidate({ groups: sites() }),
    );
    expect(decision).toEqual({
      direct: false,
      reason: 'More than one organisation fits this folder.',
    });
  });

  it('prefers sub-* folders as members over another complete organisation', () => {
    // Subject folders are the conventional reading, and the scan ranks them first.
    const summary = folderSummary([folderProposal(), byImage(FOLDER_MEMBERS), flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate()).direct).toBe(true);
  });

  it('reviews an organisation that is not the one the scan ranks first', () => {
    const summary = folderSummary([byImage(FOLDER_MEMBERS), folderProposal(), flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate())).toEqual({
      direct: false,
      reason: 'The organisation is not the one the scan ranks first.',
    });
  });

  it('reviews when another multi-image organisation places every file but has missing images', () => {
    // Nine files read as two tasks per site: every file has a place, but three
    // task images are missing. That may be the intended reading with files
    // missing, so the user decides. (Members named sub-* would open directly.)
    const groups = SITES.flatMap((member) =>
      ['task-a', 'task-b'].map((task, index) => ({
        memberId: `${member}_${task}`,
        designValues: [],
        bindings: (index === 0 ? FOLDER_IMAGES.slice(0, 2) : FOLDER_IMAGES.slice(2)).map(
          (image) => ({
            role: image,
            sourcePath: `/cache/mount-a/pcmri/derivatives/enc_rep_rsa/${member}/${image}`,
            relativePath: `${member}/${image}`,
            confidence: 0,
          }),
        ),
        missingRoles: index === 0 ? [] : [FOLDER_IMAGES[0]],
        duplicateRoles: [],
        confidence: 1,
      })),
    );
    const incomplete = folderProposal({
      id: 'by-task',
      strategy: 'path_role_condition',
      score: 0.4,
      filePattern: 'by-task',
      missingRoleBindings: 3,
      groups: groups as never,
    });
    const summary = folderSummary([folderProposal({ groups: sites() }), incomplete, flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate({ groups: sites() }))).toEqual({
      direct: false,
      reason: 'Another organisation of this folder has missing images.',
    });
  });

  it('does not count one member per file as a rival under any name', () => {
    const perFile = { ...flatFallback(), id: 'per-file', strategy: 'bids_like_entities', warnings: [] };
    const summary = folderSummary([folderProposal({ groups: sites() }), perFile, flatFallback()]);
    expect(decideFolderOpen(summary, folderCandidate({ groups: sites() })).direct).toBe(true);
  });

  it('reviews when only the fallback explains the folder, or the draft cannot be opened', () => {
    const fallback = flatFallback();
    const candidate = folderCandidate();
    candidate.discovery!.filePattern = fallback.filePattern;
    expect(decideFolderOpen(folderSummary([fallback]), candidate).direct).toBe(false);
    const blocked = folderCandidate();
    blocked.contract.canImport = false;
    expect(decideFolderOpen(folderSummary(), blocked).direct).toBe(false);
    expect(decideFolderOpen(null, folderCandidate()).direct).toBe(false);
    expect(decideFolderOpen(folderSummary(), null).direct).toBe(false);
  });

  it('reviews a draft whose header check found a problem', () => {
    const candidate = folderCandidate({ checked: true });
    candidate.set.ingestAudit.support.severity = 'warning';
    expect(decideFolderOpen(folderSummary(), candidate).direct).toBe(false);
  });
});

/**
 * What the backend returns for the owner's remote analysis folder
 * (`…/pcmri/derivatives/enc_rep_rsa`): `preview_folder_ontology` and the
 * `preview_set_studio_imports` draft of its first candidate, for an inventory
 * of `sub-NNNN/enc_rep/maps/{same_item,same_run,temporal_dist}.nii.gz`, headers
 * not read. Produced by running field_table's discovery on a replica of the
 * tree (four subjects here; the real folder has 35 and the same five
 * candidates) and kept verbatim apart from the root path.
 */
describe('decideFolderOpen on a real scan', () => {
  const scan = () =>
    structuredClone(encRepRsaScan) as unknown as {
      summary: StudioFolderOntologySummary;
      candidate: StudioImportCandidate;
    };

  it('is the scan that used to stop at the review', () => {
    const { summary, candidate } = scan();
    expect(summary.candidates.map((item) => [item.id, item.missingRoleBindings])).toEqual([
      ['member-folders', 0],
      ['maps-basename-roles', 0],
      ['flat-statmaps', 0],
      ['bids-entities', 0],
      // `same_item` read as role "same", condition "item": half of every member missing.
      ['maps-role-condition', 12],
    ]);
    expect(summary.warnings).toEqual([]);
    expect(candidate.set.ingestAudit.support.supportLabel).toBe('headers not sampled');
    expect(candidate.set.ingestAudit.support.severity).toBe('ok');
  });

  it('opens it directly', () => {
    const { summary, candidate } = scan();
    expect(decideFolderOpen(summary, candidate)).toEqual({ direct: true, members: 4, images: 3 });
  });

  it('opens it directly when the member folders are not sub-* either', () => {
    // The readings on offer do not depend on the convention: the complete
    // ones agree, and the only one that differs is a matrix with holes.
    const text = JSON.stringify(encRepRsaScan).replaceAll('sub-10', 'p10');
    const { summary, candidate } = JSON.parse(text) as ReturnType<typeof scan>;
    expect(summary.candidates[0].groups[0].memberId).toBe('p1002');
    expect(decideFolderOpen(summary, candidate).direct).toBe(true);
  });

  it('still reviews it when a file is missing', () => {
    const { summary, candidate } = scan();
    const lost = candidate.discovery!.groups[1].bindings.pop()!;
    const proposal = summary.candidates[0].groups[1];
    proposal.bindings = proposal.bindings.filter((binding) => binding.role !== lost.role);
    expect(decideFolderOpen(summary, candidate)).toEqual({
      direct: false,
      reason: 'A member is missing an image or has two.',
    });
  });

  it('still reviews it when a file is left out, the scan warned, or it was cut short', () => {
    const unmatched = scan();
    unmatched.summary.candidates[0].unmatchedFiles = 1;
    expect(decideFolderOpen(unmatched.summary, unmatched.candidate).direct).toBe(false);
    const unplaced = scan();
    unplaced.candidate.discovery!.unmatchedFiles = 1;
    expect(decideFolderOpen(unplaced.summary, unplaced.candidate).direct).toBe(false);
    const warned = scan();
    warned.summary.warnings = [{ code: 'inventory_root_issue', message: 'Unreadable.', paths: [] }];
    expect(decideFolderOpen(warned.summary, warned.candidate).direct).toBe(false);
    const cut = scan();
    cut.summary.truncated = true;
    expect(decideFolderOpen(cut.summary, cut.candidate).direct).toBe(false);
    const audited = scan();
    audited.candidate.set.ingestAudit.support.severity = 'warning';
    expect(decideFolderOpen(audited.summary, audited.candidate).direct).toBe(false);
  });
});

describe('folderReviewReasonLine', () => {
  it('states the reason as one sentence', () => {
    expect(folderReviewReasonLine('More than one organisation fits this folder.')).toBe(
      'Shown for review: more than one organisation fits this folder.',
    );
  });
});

describe('folder set naming', () => {
  it('names a set after its folder, whatever the path looks like', () => {
    expect(folderSetName('/cache/mount-a/pcmri/derivatives/enc_rep_rsa')).toBe('enc_rep_rsa');
    expect(folderSetName('/data/study/')).toBe('study');
    expect(folderSetName('C:\\data\\study')).toBe('study');
    expect(folderSetName('/')).toBeNull();
  });

  it('writes a shape with the right plurals', () => {
    expect(folderShapeLabel(35, 3)).toBe('35 members × 3 images');
    expect(folderShapeLabel(1, 1)).toBe('1 member × 1 image');
  });
});
