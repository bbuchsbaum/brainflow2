import type {
  StudioFolderOntologyCandidate,
  StudioFolderOntologySummary,
  StudioImportCandidate,
} from '@/types/studio';

/**
 * A folder shaped like the owner's remote analysis: `members` subject folders,
 * each holding the same `images` under `enc_rep/maps/`, opened without
 * reading headers.
 */
export const FOLDER_ROOT = '/cache/mount-a/pcmri/derivatives/enc_rep_rsa';
export const FOLDER_PATTERN = String.raw`^(?P<member>[^/]+)/(?P<image>.+\.nii(\.gz)?)$`;

export function folderGroups(
  members: string[],
  images: string[],
  root = FOLDER_ROOT,
): StudioFolderOntologyCandidate['groups'] {
  return members.map((memberId) => ({
    memberId,
    designValues: [{ column: 'member', value: memberId }],
    bindings: images.map((image) => ({
      role: image,
      sourcePath: `${root}/${memberId}/${image}`,
      relativePath: `${memberId}/${image}`,
      confidence: 0,
    })),
    missingRoles: [],
    duplicateRoles: [],
    confidence: 1,
  })) as unknown as StudioFolderOntologyCandidate['groups'];
}

export const FOLDER_MEMBERS = ['sub-1006', 'sub-1007', 'sub-1008'];
export const FOLDER_IMAGES = [
  'enc_rep/maps/same_item.nii.gz',
  'enc_rep/maps/same_cat.nii.gz',
  'enc_rep/maps/diff_cat.nii.gz',
];

export function folderProposal(
  overrides: Partial<StudioFolderOntologyCandidate> = {},
): StudioFolderOntologyCandidate {
  const groups = overrides.groups ?? folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES);
  return {
    id: 'member-folders',
    label: 'One member per folder',
    description: 'Immediate subfolders identify members; relative filenames identify images.',
    strategy: 'member_folders',
    score: 1,
    coverage: 1,
    completeness: 1,
    matchedFiles: 9,
    unmatchedFiles: 0,
    duplicateKeys: 0,
    missingRoleBindings: 0,
    filePattern: FOLDER_PATTERN,
    designColumns: ['member'],
    observedRoles: FOLDER_IMAGES,
    requiredRoles: [],
    rolePatterns: [],
    factors: [],
    roles: [],
    reasons: [],
    warnings: [],
    ...overrides,
    groups,
  } as StudioFolderOntologyCandidate;
}

/** The fallback every folder is offered: each file its own member. */
export function flatFallback(): StudioFolderOntologyCandidate {
  const files = FOLDER_MEMBERS.flatMap((member) => FOLDER_IMAGES.map((image) => `${member}/${image}`));
  return folderProposal({
    id: 'flat-statmaps',
    label: 'One member per file',
    strategy: 'flat_statmap_fallback',
    score: 0.6,
    filePattern: String.raw`^(?P<member>.+\.nii(\.gz)?)$`,
    observedRoles: ['image'],
    groups: files.map((file) => ({
      memberId: file,
      designValues: [],
      bindings: [{ role: 'image', sourcePath: `${FOLDER_ROOT}/${file}`, relativePath: file, confidence: 0 }],
      missingRoles: [],
      duplicateRoles: [],
      confidence: 1,
    })) as unknown as StudioFolderOntologyCandidate['groups'],
    warnings: [{ code: 'fallback_schema', message: 'Review member names carefully.', paths: [] }],
  });
}

export function folderSummary(
  candidates: StudioFolderOntologyCandidate[] = [folderProposal(), flatFallback()],
  overrides: Partial<StudioFolderOntologySummary> = {},
): StudioFolderOntologySummary {
  return {
    root: FOLDER_ROOT,
    rootExists: true,
    sourceLabel: 'brad@trillium.alliancecan.ca:/scratch/brad/dsets',
    scannedFiles: 9,
    neuroimagingFiles: 9,
    truncated: false,
    candidates,
    warnings: [],
    ...overrides,
  };
}

/** The draft the backend returns for the proposal: unchecked grids, clean files. */
export function folderCandidate(
  options: {
    groups?: StudioFolderOntologyCandidate['groups'];
    checked?: boolean;
    unmatchedFiles?: number;
    setId?: string;
  } = {},
): StudioImportCandidate {
  const groups = options.groups ?? folderGroups(FOLDER_MEMBERS, FOLDER_IMAGES);
  const checked = options.checked ?? false;
  const memberIds = groups.map((group) => group.memberId);
  const supportLabel = checked ? '2 mm grid (sampled)' : 'headers not sampled';
  return {
    id: 'candidate-regex-folder',
    label: 'Folder preview',
    description: 'Grouped files beneath the folder.',
    mode: 'regex',
    sourceHint: `root=${FOLDER_ROOT}`,
    contract: {
      readiness: checked ? 'compare_ready' : 'review_required',
      provenanceKind: 'regex_discovery',
      provenanceLabel: FOLDER_ROOT,
      canImport: true,
      capabilities: checked
        ? ['import', 'deck', 'compare', 'materialize_compare']
        : ['import', 'deck'],
      reason: checked ? 'Ready.' : 'Image headers were not read.',
    },
    set: {
      id: options.setId ?? 'folder-set',
      // What the backend calls a folder preview: the mount, then a working title.
      name: 'brad@trillium.alliancecan.ca:/scratch/brad/dsets / Discovery Import',
      sourceKind: 'imported',
      memberCount: memberIds.length,
      primaryFeatureId: FOLDER_IMAGES[0],
      supportKind: 'volume',
      supportLabel,
      alignmentClass: checked ? 'same-grid' : 'unknown',
      designColumns: ['member'],
      designTablePreview: { columns: ['member'], rows: [] },
      memberSummaries: groups.map((group) => ({
        id: group.memberId,
        sourcePath: group.bindings[0]?.sourcePath ?? null,
        bindings: group.bindings.map((binding) => ({
          role: binding.role,
          sourcePath: binding.sourcePath,
          selector: null,
          availability: 'available',
        })),
      })),
      memberIds,
      savedCohortIds: ['all-members'],
      ingestAudit: {
        sourceLabel: 'Folder',
        join: {
          matchedRows: memberIds.length * FOLDER_IMAGES.length,
          unmatchedRows: options.unmatchedFiles ?? 0,
          duplicateKeys: 0,
          severity: options.unmatchedFiles ? 'warning' : 'ok',
          issueDetails: [],
        },
        support: {
          supportLabel,
          alignmentClass: checked ? 'same-grid' : 'unknown',
          readyForCompare: checked,
          severity: 'ok',
        },
        notes: [],
      },
    },
    features: [{ id: FOLDER_IMAGES[0], label: 'same_item', kind: 'volume' }],
    cohorts: [
      {
        id: 'all-members',
        label: 'All members',
        memberCount: memberIds.length,
        description: 'Every member.',
        memberIds,
        originKind: 'imported',
        originLabel: 'Folder',
      },
    ],
    expressions: [
      { id: 'member', label: 'Current member', kind: 'member', recipe: 'member(current)', cohortId: null },
    ],
    materialization: null,
    discovery: {
      root: FOLDER_ROOT,
      filePattern: FOLDER_PATTERN,
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      maxDepth: 4,
      maxFiles: 500,
      dryRun: true,
      sampleHeaders: checked,
      captureNames: ['member', 'image'],
      inferredDesignColumns: ['member'],
      observedRoles: FOLDER_IMAGES,
      requiredRoles: [],
      matchedFiles: memberIds.length * FOLDER_IMAGES.length,
      unmatchedFiles: options.unmatchedFiles ?? 0,
      duplicateKeys: 0,
      truncated: false,
      groups,
    },
  } as unknown as StudioImportCandidate;
}
