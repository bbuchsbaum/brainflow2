import React from 'react';
import { Chip, StatusPill, type StatusKind } from '@/components/ui/bf';
import type {
  SpatialFieldSetSummary,
  StudioAuditSeverity,
} from '@/types/studio';

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
}

export function StudioAuditBanner({ activeSet, readiness }: StudioAuditBannerProps) {
  if (!activeSet || !readiness) {
    return null;
  }

  const audit = activeSet.ingestAudit;
  const totalRows = audit.join.matchedRows + audit.join.unmatchedRows;
  const matchedPct =
    totalRows > 0 ? Math.round((audit.join.matchedRows / totalRows) * 100) : 100;
  const supportCoveragePct = audit.support.readyForCompare ? 100 : null;

  const tone = toneClasses(readiness.state);

  return (
    <section
      aria-label="Set studio audit summary"
      className={`mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-1.5 text-bf-sm ${tone.container}`}
    >
      <StatusPill status={readinessStatus(readiness.state)}>{readiness.eyebrow}</StatusPill>
      <span className="h-4 w-px bg-border" aria-hidden />
      <AuditFact
        label="Matched"
        value={`${audit.join.matchedRows}`}
        suffix={totalRows > 0 ? `(${matchedPct}%)` : undefined}
        // Matched rows are a count, not a caution: stay neutral unless the
        // join failed outright. Unmatched rows carry the warning tone.
        severity={audit.join.severity === 'error' ? 'error' : 'ok'}
      />
      <AuditFact
        label="Unmatched"
        value={`${audit.join.unmatchedRows}`}
        severity={audit.join.unmatchedRows > 0 ? 'warning' : 'ok'}
      />
      <AuditFact
        label="Duplicates"
        value={`${audit.join.duplicateKeys}`}
        severity={audit.join.duplicateKeys > 0 ? 'warning' : 'ok'}
      />
      <AuditFact
        label="Alignment"
        value={audit.support.alignmentClass}
        severity={audit.support.severity}
        wide
      />
      <AuditFact
        label="Support"
        value={audit.support.supportLabel}
        suffix={supportCoveragePct != null ? `(${supportCoveragePct}%)` : undefined}
        severity={audit.support.severity}
        wide
      />
    </section>
  );
}

function readinessStatus(state: WorkspaceReadiness['state']): StatusKind {
  if (state === 'ready') return 'success';
  if (state === 'review') return 'warning';
  return 'failed';
}

/**
 * One audit fact. Neutral facts are static Chips; a warning or error fact is
 * a StatusPill so the severity carries an icon as well as colour.
 */
function AuditFact({
  label,
  value,
  suffix,
  severity = 'ok',
  wide,
}: {
  label: string;
  value: string;
  suffix?: string;
  severity?: StudioAuditSeverity;
  wide?: boolean;
}) {
  const content = (
    <>
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-mono tabular-nums">{value}</span>
      {suffix ? <span className="font-mono tabular-nums text-muted-foreground"> {suffix}</span> : null}
    </>
  );
  const title = `${label} ${value}${suffix ? ` ${suffix}` : ''}`;
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
      return {
        container: 'border-border bg-card text-foreground',
      };
    case 'review':
      return {
        container: 'border-bf-warning/50 bg-card text-foreground',
      };
    case 'blocked':
    default:
      return {
        container:
          'border-destructive/40 bg-bf-danger-soft text-foreground',
      };
  }
}
