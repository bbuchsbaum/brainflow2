/**
 * Helpers for the cohort plot: resolving the active Set-Studio set into a
 * sampleable cohort (members with a loadable source path + the design table).
 *
 * NOTE: `designTablePreview` is a truncated preview (a handful of rows), so
 * covariates are only available for the preview members today; non-preview
 * members join to null factors. The full per-member design table is not yet
 * exposed to the frontend — see docs/plans/plot-grammar-sample-frame.md.
 */

import { useMemo } from "react";

import { useSetStudioStore } from "@/stores/setStudioStore";
import type { SpatialFieldSetSummary } from "@/types/studio";

export interface CohortDesignTable {
  columns: string[];
  rows: { id: string; cells: string[] }[];
}

export interface ActiveCohort {
  setId: string;
  setName: string;
  /** Members with a non-empty source path (sampleable). */
  members: { memberId: string; sourcePath: string }[];
  /** The (preview) design table, in `joinDesignTable` shape. */
  designTable: CohortDesignTable;
  /** Full design column list (covariate names). */
  designColumns: string[];
}

function deriveCohort(set: SpatialFieldSetSummary | null): ActiveCohort | null {
  if (!set) return null;
  const members = set.memberSummaries
    .filter((m) => typeof m.sourcePath === "string" && m.sourcePath.length > 0)
    .map((m) => ({ memberId: m.id, sourcePath: m.sourcePath as string }));
  if (members.length === 0) return null;
  return {
    setId: set.id,
    setName: set.name,
    members,
    designTable: set.designTablePreview ?? { columns: [], rows: [] },
    designColumns: set.designColumns,
  };
}

function activeSetSummary(state: {
  selection: { activeSetId: string | null };
  sets: Record<string, SpatialFieldSetSummary>;
}): SpatialFieldSetSummary | null {
  const id = state.selection.activeSetId;
  return id ? (state.sets[id] ?? null) : null;
}

/** Reactive active cohort (or null). */
export function useActiveCohort(): ActiveCohort | null {
  const set = useSetStudioStore(activeSetSummary);
  return useMemo(() => deriveCohort(set), [set]);
}

/** Non-reactive active cohort (for `supports`). */
export function getActiveCohort(): ActiveCohort | null {
  return deriveCohort(activeSetSummary(useSetStudioStore.getState()));
}
