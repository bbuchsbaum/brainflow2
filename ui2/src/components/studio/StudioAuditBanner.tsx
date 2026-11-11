import { Chip, StatusPill, type StatusKind } from '@/components/ui/bf';
import type { SpatialFieldSetSummary, StudioAuditSeverity } from '@/types/studio';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';

interface WorkspaceReadiness {
  state: 'ready' | 'review' | 'blocked';
  eyebrow: string;
  title: string;
  message: string;
  className: string;
}

interface StudioAuditBannerProps {
  activeSet: SpatialFieldSetSummary | null;
  readiness: WorkspaceReadiness | null;
  /**
   * One line inside the Studio header (QA N13): no frame, never wraps; facts
   * that do not fit are clipped and read in full from the tooltip.
   */
  inline?: boolean;
}

/**
 * What the import found, at set level and once: whether the set can be read
 * together (the state of its image grids), how many images matched, and any
 * that did not. Counts of zero are not shown; a clean set reads
 * "Ready to compare · 105 images". The grid state lives here, not in every
 * pane.
 */
export function StudioAuditBanner({ activeSet, readiness, inline = false }: StudioAuditBannerProps) {
  const grids = useStudioReadiness('compare');
  if (!activeSet || !readiness) {
    return null;
  }

  const audit = activeSet.ingestAudit;
  const pill = statePill(readiness, grids.phase, !!activeSet.savedPopulation);
  const grid =
    audit.support.alignmentClass === 'same-grid' && audit.support.supportLabel
      ? audit.support.supportLabel
      : null;
  const images = `${audit.join.matchedRows} ${audit.join.matchedRows === 1 ? 'image' : 'images'}`;

  const summary = [
    pill.label,
    pill.detail,
    images,
    audit.join.unmatchedRows > 0 ? `${audit.join.unmatchedRows} unmatched` : null,
    audit.join.duplicateKeys > 0 ? `${audit.join.duplicateKeys} duplicates` : null,
    grid ? `Grid ${grid}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-label="Set studio audit summary"
      title={inline ? summary : undefined}
      className={
        inline
          ? 'flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden text-bf-sm [&>*]:shrink-0'
          : `mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-1.5 text-bf-sm ${toneClasses(readiness.state)}`
      }
    >
      <StatusPill status={pill.status} title={pill.detail ?? undefined} data-phase={grids.phase}>
        {pill.label}
      </StatusPill>
      <AuditFact value={images} severity={audit.join.severity === 'error' ? 'error' : 'ok'} />
      {audit.join.unmatchedRows > 0 ? (
        <AuditFact value={`${audit.join.unmatchedRows} unmatched`} severity="warning" />
      ) : null}
      {audit.join.duplicateKeys > 0 ? (
        <AuditFact value={`${audit.join.duplicateKeys} duplicates`} severity="warning" />
      ) : null}
      {grid ? <AuditFact label="Grid" value={grid} wide /> : null}
    </section>
  );
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

/**
 * One audit fact. Neutral facts are static Chips; a warning or error fact is
 * a StatusPill so the severity carries an icon as well as colour.
 */
function AuditFact({
  label,
  value,
  severity = 'ok',
  wide,
}: {
  label?: string;
  value: string;
  severity?: StudioAuditSeverity;
  wide?: boolean;
}) {
  const content = (
    <>
      {label ? <span className="text-muted-foreground">{label} </span> : null}
      <span className="tabular-nums">{value}</span>
    </>
  );
  const title = label ? `${label} ${value}` : value;
  if (severity === 'ok') {
    return (
      <Chip title={title} className={wide ? 'max-w-[260px]' : undefined}>
        {content}
      </Chip>
    );
  }
  return (
    <StatusPill
      status={severity === 'error' ? 'failed' : 'warning'}
      title={title}
      className={wide ? 'max-w-[260px] truncate' : undefined}
    >
      <span className="truncate">{content}</span>
    </StatusPill>
  );
}

function toneClasses(state: WorkspaceReadiness['state']) {
  switch (state) {
    case 'ready':
      return 'border-border bg-card text-foreground';
    case 'review':
      return 'border-bf-warning/50 bg-card text-foreground';
    case 'blocked':
    default:
      return 'border-destructive/40 bg-bf-danger-soft text-foreground';
  }
}
