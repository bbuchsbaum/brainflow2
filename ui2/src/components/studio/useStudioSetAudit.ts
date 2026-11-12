import type { StatusKind } from '@/components/ui/bf';
import type { SpatialFieldSetSummary, StudioAuditSeverity } from '@/types/studio';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';

export interface WorkspaceReadiness {
  state: 'ready' | 'review' | 'blocked';
  eyebrow: string;
  title: string;
  message: string;
  className: string;
}

/** The set's audit, said once: its status and the facts behind it. */
export interface StudioSetAudit {
  status: { status: StatusKind; label: string; detail: string | null };
  /**
   * The status is worth a word on the header: anything but ready (or a saved
   * calculation). A ready set says nothing there; its facts are in ⓘ.
   */
  problem: boolean;
  images: string;
  imagesSeverity: StudioAuditSeverity;
  unmatched: number;
  duplicates: number;
  /** The grid all images share, when they share one. */
  grid: string | null;
  /** Every fact on one line ("Ready to compare · 105 images · Grid …"). */
  summary: string;
  /** The grid phase, for `data-phase`. */
  phase: ReturnType<typeof useStudioReadiness>['phase'];
}

/** The set's audit facts; null without a set or a readiness. */
export function useStudioSetAudit(
  activeSet: SpatialFieldSetSummary | null,
  readiness: WorkspaceReadiness | null,
): StudioSetAudit | null {
  const grids = useStudioReadiness('compare');
  if (!activeSet || !readiness) return null;
  const audit = activeSet.ingestAudit;
  const status = statePill(readiness, grids.phase, !!activeSet.savedPopulation);
  const grid =
    audit.support.alignmentClass === 'same-grid' && audit.support.supportLabel
      ? audit.support.supportLabel
      : null;
  const images = `${audit.join.matchedRows} ${audit.join.matchedRows === 1 ? 'image' : 'images'}`;
  const summary = [
    status.label,
    status.detail,
    images,
    audit.join.unmatchedRows > 0 ? `${audit.join.unmatchedRows} unmatched` : null,
    audit.join.duplicateKeys > 0 ? `${audit.join.duplicateKeys} duplicates` : null,
    grid ? `Grid ${grid}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    status,
    problem: status.status !== 'success',
    images,
    imagesSeverity: audit.join.severity === 'error' ? 'error' : 'ok',
    unmatched: audit.join.unmatchedRows,
    duplicates: audit.join.duplicateKeys,
    grid,
    summary,
    phase: grids.phase,
  };
}

/**
 * The set's one status. A set whose grids are unchecked or being checked is
 * waiting, not at fault: only a check that failed, images that cannot be
 * read together, or a blocked import carry a status colour.
 */
function statePill(
  readiness: WorkspaceReadiness,
  phase: ReturnType<typeof useStudioReadiness>['phase'],
  savedPopulation: boolean,
): { status: StatusKind; label: string; detail: string | null } {
  if (savedPopulation) return { status: 'success', label: readiness.eyebrow, detail: null };
  if (readiness.state === 'blocked')
    return { status: 'failed', label: readiness.eyebrow, detail: readiness.message };
  switch (phase) {
    case 'ready':
      return { status: 'success', label: 'Ready to compare', detail: null };
    case 'checking':
      return { status: 'running', label: 'Checking image grids', detail: null };
    case 'needs-check':
      return { status: 'queued', label: 'Image grids not checked', detail: null };
    case 'check-failed':
      return { status: 'warning', label: 'Grid check failed', detail: null };
    default:
      return { status: 'warning', label: 'Browse only', detail: readiness.message };
  }
}

