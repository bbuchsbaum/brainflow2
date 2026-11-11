import { describe, expect, it } from 'vitest';
import type { SpatialFieldSetSummary, StudioSetDiscoveryRequest } from '@/types/studio';
import { populationReadinessIssue } from '../populationReadiness';

const request: StudioSetDiscoveryRequest = {
  root: '/data/study',
  filePattern: '(?P<subject>[^/]+)/(?P<role>tstat)\\.nii',
  includePatterns: [],
  excludePatterns: [],
  rolePatterns: [],
  requiredRoles: [],
  maxDepth: 4,
  maxFiles: 100,
};

function makeSet(overrides: {
  supportKind?: SpatialFieldSetSummary['supportKind'];
  readiness?: NonNullable<SpatialFieldSetSummary['importContract']>['readiness'];
  alignment?: SpatialFieldSetSummary['alignmentClass'];
  supportSeverity?: 'ok' | 'warning' | 'error';
  joinSeverity?: 'ok' | 'warning' | 'error';
  unmatchedRows?: number;
  issues?: string[];
  discoveryRequest?: StudioSetDiscoveryRequest;
  savedPopulation?: boolean;
  provenanceKind?: NonNullable<SpatialFieldSetSummary['importContract']>['provenanceKind'];
}): SpatialFieldSetSummary {
  const alignment = overrides.alignment ?? 'unknown';
  return {
    id: 'study-regex-preview',
    supportKind: overrides.supportKind ?? 'volume',
    supportLabel: 'headers not sampled',
    alignmentClass: alignment,
    importContract: {
      readiness: overrides.readiness ?? 'review_required',
      provenanceKind: overrides.provenanceKind ?? 'regex_discovery',
      provenanceLabel: 'root=/data/study',
      canImport: true,
      capabilities: ['import', 'deck'],
      reason: 'Backend audit found warnings; import for review before compare.',
    },
    ingestAudit: {
      sourceLabel: 'Regex discovery',
      join: {
        matchedRows: 4,
        unmatchedRows: overrides.unmatchedRows ?? 0,
        duplicateKeys: 0,
        severity: overrides.joinSeverity ?? 'ok',
        issueDetails: (overrides.issues ?? []).map((message) => ({ message, memberIds: [] })),
      },
      support: {
        supportLabel: 'headers not sampled',
        alignmentClass: alignment,
        readyForCompare: false,
        severity: overrides.supportSeverity ?? 'ok',
      },
      notes: [],
    },
    ...(overrides.discoveryRequest ? { discoveryRequest: overrides.discoveryRequest } : {}),
    ...(overrides.savedPopulation ? { savedPopulation: {} } : {}),
  } as unknown as SpatialFieldSetSummary;
}

describe('populationReadinessIssue', () => {
  it('has no issue for a compare-ready volume set or verified saved inputs', () => {
    expect(populationReadinessIssue(null)).toBeNull();
    expect(
      populationReadinessIssue(makeSet({ readiness: 'compare_ready', alignment: 'same-grid' })),
    ).toBeNull();
    expect(populationReadinessIssue(makeSet({ savedPopulation: true }))).toBeNull();
  });

  it('says Population is for volumes when the set is not one, whatever its readiness', () => {
    const issue = populationReadinessIssue(
      makeSet({ supportKind: 'surface', readiness: 'compare_ready' }),
    );
    expect(issue).toEqual({
      kind: 'not-volume',
      message:
        'Population works on volume images only. This set holds surface data; use Deck or Compare instead.',
      canCheckGrids: false,
    });
  });

  it('offers the in-place check when a folder-opened set was never checked', () => {
    const issue = populationReadinessIssue(makeSet({ discoveryRequest: request }));
    expect(issue?.canCheckGrids).toBe(true);
    expect(issue?.message).toBe(
      'Population reads every member at the same location, so all images must be on one grid. The image grids in this set have not been checked yet. Choose Check image grids to read the image headers.',
    );
  });

  it('tells the user to reopen with the option when the discovery was not kept', () => {
    const issue = populationReadinessIssue(makeSet({}));
    expect(issue?.canCheckGrids).toBe(false);
    expect(issue?.message).toContain('have not been checked.');
    expect(issue?.message).toContain('“Check image grids before opening” turned on');
  });

  it('does not send a manifest or table import to a folder option it never had', () => {
    const manifest = populationReadinessIssue(makeSet({ provenanceKind: 'manifest' }));
    expect(manifest).toEqual({
      kind: 'unchecked',
      message:
        'Population reads every member at the same location, so all images must be on one grid. The manifest this set was opened from does not declare one grid for its images. Declare the grid in the manifest, then open the manifest again.',
      canCheckGrids: false,
    });
    const table = populationReadinessIssue(makeSet({ provenanceKind: 'table' }));
    expect(table).toEqual({
      kind: 'unchecked',
      message:
        'Population reads every member at the same location, so all images must be on one grid. No image listed in this table could be read to find its grid. Check the file paths in the table, then import it again.',
      canCheckGrids: false,
    });
    const other = populationReadinessIssue(makeSet({ provenanceKind: 'demo' }));
    expect(other?.message).toBe(
      'Population reads every member at the same location, so all images must be on one grid. The image grids in this set have not been checked.',
    );
    for (const issue of [manifest, table, other])
      expect(issue?.message).not.toContain('Check image grids before opening');
  });

  it('reports why a check failed and lets the user try again', () => {
    const issue = populationReadinessIssue(
      makeSet({
        discoveryRequest: request,
        supportSeverity: 'warning',
        issues: ['2 matched files were not grouped.', 'Failed to read header of sub-01/tstat.nii'],
      }),
    );
    expect(issue?.canCheckGrids).toBe(true);
    expect(issue?.message).toContain(
      'The image grids could not be checked: Failed to read header of sub-01/tstat.nii',
    );
  });

  it('treats headers that could not be read as an unfinished check, not as differing grids', () => {
    // What the audit reports when the only problem is unread headers
    // (field_table preview/discovery.rs): alignment unknown, severity error.
    const issue = populationReadinessIssue(
      makeSet({
        discoveryRequest: request,
        readiness: 'inspect_only',
        alignment: 'unknown',
        supportSeverity: 'error',
        issues: [
          '2 matched image header(s) could not be read; first error: sub-01/tstat.nii: timed out',
        ],
      }),
    );
    expect(issue?.canCheckGrids).toBe(true);
    expect(issue?.message).toContain(
      'The image grids could not be checked: 2 matched image header(s) could not be read',
    );
    expect(issue?.message).not.toContain('Resample');
  });

  it('reports differing grids with the audit finding and no check to run', () => {
    const issue = populationReadinessIssue(
      makeSet({
        discoveryRequest: request,
        readiness: 'inspect_only',
        alignment: 'mixed',
        supportSeverity: 'error',
        issues: ['3 member group(s) use a different grid than the first sampled image.'],
      }),
    );
    expect(issue?.canCheckGrids).toBe(false);
    expect(issue?.message).toContain(
      '3 member group(s) use a different grid than the first sampled image. Resample the images to one grid',
    );
  });

  it('separates file-matching problems from grid problems once the grids match', () => {
    const issue = populationReadinessIssue(
      makeSet({
        discoveryRequest: request,
        alignment: 'same-grid',
        joinSeverity: 'warning',
        unmatchedRows: 2,
        issues: ['2 file(s) did not match the filename rule.'],
      }),
    );
    expect(issue?.canCheckGrids).toBe(false);
    expect(issue?.message).toBe(
      'The image grids match, but the set has file problems: 2 file(s) did not match the filename rule. Fix them, or narrow the filename matching, then open the set again.',
    );
  });

  it('never uses the audit jargon', () => {
    for (const set of [makeSet({}), makeSet({ supportKind: 'surface' }), makeSet({ alignment: 'same-space' })])
      expect(populationReadinessIssue(set)?.message).not.toMatch(/audited|common support/i);
  });
});
