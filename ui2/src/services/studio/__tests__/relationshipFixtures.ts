import type { RelationshipFit, RelationshipRequest } from '../PopulationRelationshipService';

/** Synthetic relationship fits shared by service and component tests. */
export function syntheticFit(request: RelationshipRequest): RelationshipFit {
  const n = request.members.length;
  return {
    fitId: 'f'.repeat(64),
    supportSha256: 'b'.repeat(64),
    request: {
      ...request,
      members: request.members.map((m) => ({ ...m, expectedSha256: 'a'.repeat(64) })),
      mask: request.mask ? { ...request.mask, expectedSha256: 'c'.repeat(64) } : null,
    },
    candidateVoxels: 100,
    commonVoxels: 90,
    finiteCounts: Array(n).fill(95),
    dimensions: [5, 5, 4],
    affine: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
    geometry: {
      coordinates: request.members.map((_, i) => [i, 0]),
      distances: request.members.map((_, i) => request.members.map((_, j) => Math.abs(i - j))),
      eigenvalues: [n, ...Array(n - 1).fill(0)],
      stress: 0,
      explainedFraction: 1,
      orderable: true,
      merges: Array.from({ length: n - 1 }, (_, i) => ({
        left: i === 0 ? 0 : n + i - 1,
        right: i + 1,
        count: i + 2,
        distance: i + 1,
      })),
    },
  };
}
/** A v2 fit in which `unassigned` positions (request order) have no fitted position. */
export function syntheticV2Fit(request: RelationshipRequest, unassigned: number[]): RelationshipFit {
  const base = syntheticFit(request);
  const ids = base.request.members.map((m) => m.memberId);
  const fitted = ids.filter((_, i) => !unassigned.includes(i));
  const m = fitted.length;
  const geometry = syntheticFit({ ...request, members: request.members.slice(0, m) }).geometry;
  return {
    ...base,
    request: { ...base.request, eligibility: { lowCoverageTau: 0.9 } },
    finiteCounts: ids.map((_, i) => (unassigned.includes(i) ? (i % 2 ? 0 : 40) : 95)),
    fittedMemberIds: fitted,
    unassigned: unassigned.map((i) => ({
      memberId: ids[i],
      reason: i % 2 ? { kind: 'allMissing' as const } : { kind: 'lowCoverage' as const, fraction: 40 / 95 },
      finiteCount: i % 2 ? 0 : 40,
      supportLossVoxels: i % 2 ? 90 : 50,
    })),
    geometry,
  };
}
/**
 * A grouping (v3) fit of the six demo members on a line: the request echoes
 * `grouping`, and the geometry carries Ward linkage and scored cuts. The
 * three-group cut leaves sub006 alone (an outlier).
 */
export function syntheticGroupingFit(
  request: RelationshipRequest,
  options: { bestGroups?: number | null; clearGrouping?: boolean } = {},
): RelationshipFit {
  const base = syntheticFit({ ...request, grouping: request.grouping ?? {} });
  const assignments: Record<number, number[]> = {
    2: [0, 0, 0, 1, 1, 1],
    3: [0, 0, 1, 1, 1, 2],
    4: [0, 0, 1, 1, 2, 3],
    5: [0, 1, 2, 2, 3, 4],
  };
  return {
    ...base,
    request: { ...base.request, grouping: { linkage: 'ward' } },
    geometry: {
      ...base.geometry,
      grouping: {
        linkage: 'ward',
        cuts: [2, 3, 4, 5].map((groups) => {
          const assignment = assignments[groups];
          const sizes = assignment.reduce<number[]>((n, g) => ((n[g] = (n[g] ?? 0) + 1), n), []);
          return {
            groups,
            silhouette: groups === 3 ? 0.61 : 0.3,
            assignment,
            singletons: assignment.flatMap((g, i) => (sizes[g] === 1 ? [i] : [])),
          };
        }),
        bestGroups: options.bestGroups === undefined ? 3 : options.bestGroups,
        clearGrouping: options.clearGrouping ?? true,
        silhouetteThreshold: 0.25,
      },
    },
  };
}
