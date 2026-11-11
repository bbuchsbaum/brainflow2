import type { SpatialFieldSetSummary } from '@/types/studio';

export const FOLDER_IMAGES = [
  'enc_rep/maps/same_item.nii.gz',
  'enc_rep/maps/same_run.nii.gz',
  'enc_rep/maps/temporal_dist.nii.gz',
];

/**
 * A set as opened from a folder: `count` members (`sub-1002`…), each with the
 * images in FOLDER_IMAGES unless `imagesOf` says otherwise, and the
 * synthesized `member` and `roles` design columns.
 */
export function folderSet(
  count: number,
  imagesOf: Record<string, string[]> = {},
  extra?: (index: number) => Record<string, string>,
): SpatialFieldSetSummary {
  const ids = Array.from({ length: count }, (_, index) => `sub-${1002 + index}`);
  const extraColumns = extra ? Object.keys(extra(0)) : [];
  return {
    id: 'enc_rep_rsa',
    name: 'enc_rep_rsa',
    memberCount: count,
    primaryFeatureId: FOLDER_IMAGES[0],
    supportKind: 'volume',
    supportLabel: 'headers not sampled',
    alignmentClass: 'same-grid',
    designColumns: ['member', ...extraColumns, 'roles'],
    designTablePreview: null,
    memberIds: ids,
    savedCohortIds: [],
    sourceKind: 'imported',
    discoveryRequest: {
      root: '/data/enc_rep_rsa',
      filePattern: '(?P<member>sub-\\d+)/(?P<image>.+)',
      includePatterns: [],
      excludePatterns: [],
      rolePatterns: [],
      requiredRoles: FOLDER_IMAGES,
      maxDepth: null,
      maxFiles: 5000,
    },
    memberSummaries: ids.map((id, index) => {
      const images = imagesOf[id] ?? FOLDER_IMAGES;
      return {
        id,
        sourcePath: `/data/enc_rep_rsa/${id}/${images[0]}`,
        designValues: { member: id, ...(extra?.(index) ?? {}), roles: [...images].sort().join(',') },
        bindings: images.map((role, position) => ({
          role,
          featureId: role,
          sourceLocator: `${id}/${role}`,
          sourcePath: `/data/enc_rep_rsa/${id}/${role}`,
          relativePath: `${id}/${role}`,
          selector: null,
          supportKind: 'volume' as const,
          supportLabel: 'headers not sampled',
          availability: 'available' as const,
          isPrimary: position === 0,
        })),
      };
    }),
    ingestAudit: {
      sourceLabel: 'Folder',
      join: { matchedRows: count, unmatchedRows: 0, duplicateKeys: 0, severity: 'ok', issueDetails: [] },
      support: {
        supportLabel: 'headers not sampled',
        alignmentClass: 'same-grid',
        readyForCompare: true,
        severity: 'ok',
      },
      notes: [],
    },
  };
}
