import { Chip, StatusPill } from '@/components/ui/bf';
import type { SpatialFieldSetSummary, StudioAuditSeverity } from '@/types/studio';
import {
  useStudioSetAudit,
  type StudioSetAudit,
  type WorkspaceReadiness,
} from './useStudioSetAudit';


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
 * The header's status word: shown only when something is wrong or still
 * pending (a blocked import, grids unchecked or being checked, unmatched or
 * duplicate rows). A ready set shows nothing here.
 */
export function StudioSetStatusWord({ audit }: { audit: StudioSetAudit | null }) {
  if (!audit) return null;
  const join = audit.unmatched > 0 || audit.duplicates > 0 || audit.imagesSeverity === 'error';
  if (!audit.problem && !join) return null;
  return (
    <span
      className="flex min-w-0 shrink items-center gap-1 overflow-hidden"
      data-testid="studio-set-status"
      title={audit.summary}
    >
      {audit.problem ? (
        <StatusPill
          status={audit.status.status}
          title={audit.status.detail ?? undefined}
          data-phase={audit.phase}
        >
          {audit.status.label}
        </StatusPill>
      ) : null}
      {audit.imagesSeverity === 'error' ? <AuditFact value={audit.images} severity="error" /> : null}
      {audit.unmatched > 0 ? (
        <AuditFact value={`${audit.unmatched} unmatched`} severity="warning" />
      ) : null}
      {audit.duplicates > 0 ? (
        <AuditFact value={`${audit.duplicates} duplicates`} severity="warning" />
      ) : null}
    </span>
  );
}

/**
 * What the import found, at set level and once: whether the set can be read
 * together (the state of its image grids), how many images matched, and any
 * that did not. Counts of zero are not shown; a clean set reads
 * "Ready to compare · 105 images". The Studio's header shows only a problem
 * (StudioSetStatusWord) and keeps these facts behind its ⓘ; this banner is
 * the whole line, for a header shown on its own.
 */
export function StudioAuditBanner({ activeSet, readiness, inline = false }: StudioAuditBannerProps) {
  const audit = useStudioSetAudit(activeSet, readiness);
  if (!audit || !readiness) {
    return null;
  }

  return (
    <section
      aria-label="Set studio audit summary"
      title={inline ? audit.summary : undefined}
      className={
        inline
          ? 'flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden text-bf-sm [&>*]:shrink-0'
          : `mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-1.5 text-bf-sm ${toneClasses(readiness.state)}`
      }
    >
      <StatusPill
        status={audit.status.status}
        title={audit.status.detail ?? undefined}
        data-phase={audit.phase}
      >
        {audit.status.label}
      </StatusPill>
      <AuditFact value={audit.images} severity={audit.imagesSeverity} />
      {audit.unmatched > 0 ? (
        <AuditFact value={`${audit.unmatched} unmatched`} severity="warning" />
      ) : null}
      {audit.duplicates > 0 ? (
        <AuditFact value={`${audit.duplicates} duplicates`} severity="warning" />
      ) : null}
      {audit.grid ? <AuditFact label="Grid" value={audit.grid} wide /> : null}
    </section>
  );
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
