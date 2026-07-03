/**
 * Helpers + constants for the cross-set trace plot mode. Kept out of the
 * component files so fast-refresh boundaries stay clean (components in their own
 * modules; pure helpers/constants here).
 */

import type { Locus } from '@/plotting';

import type { ActiveCohort } from './cohortPlot.helpers';

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const SET_TRACE_MODE_ID = 'set-trace';

/**
 * Default sphere radius (mm) for a trace when the user hasn't chosen one. Unlike
 * the cohort box (single-voxel default), a trace's band is a *within-member*
 * dispersion over the ROI voxels, so it needs a multi-voxel ROI to be non-empty;
 * a single voxel collapses the band to the point value.
 */
export const DEFAULT_TRACE_RADIUS_MM = 6;

export type TraceMember = Extract<Locus, { kind: 'set' }>['members'][number];

/**
 * Augment the cohort's sampleable members with ontology labels from its design
 * table, so the returned trace carries a `memberLabel` + one nominal column per
 * covariate (which drive the labelled member axis). Members with no design row
 * pass through unlabelled (they render under their raw member id).
 */
export function buildTraceMembers(cohort: ActiveCohort): TraceMember[] {
  const { columns, rows } = cohort.designTable;
  const byId = new Map(rows.map((r) => [r.id, r.cells]));
  return cohort.members.map((m) => {
    const cells = byId.get(m.memberId);
    if (!cells || columns.length === 0) {
      return { memberId: m.memberId, sourcePath: m.sourcePath };
    }
    const designValues = columns
      .map((column, i) => ({ column, value: cells[i] ?? '' }))
      .filter((d) => d.value !== '');
    if (designValues.length === 0) {
      return { memberId: m.memberId, sourcePath: m.sourcePath };
    }
    return {
      memberId: m.memberId,
      sourcePath: m.sourcePath,
      // Mirror the backend's composite display (values joined) so the axis tick
      // reads e.g. "sub-03 · faces" rather than a bare member id.
      displayLabel: designValues.map((d) => d.value).join(' · '),
      designValues,
    };
  });
}
