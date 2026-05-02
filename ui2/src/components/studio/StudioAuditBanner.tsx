import React from 'react';
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
  const StatusIcon = stateIcon(readiness.state);

  return (
    <section
      aria-label="Set Studio audit summary"
      className={`mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-xs ${tone.container}`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon className={`h-4 w-4 ${tone.icon}`} aria-hidden />
        <span className={`text-[11px] font-medium uppercase tracking-[0.06em] ${tone.label}`}>
          {readiness.eyebrow}
        </span>
      </div>
      <span className="h-4 w-px bg-border" aria-hidden />
      <Chip
        label="Matched"
        value={`${audit.join.matchedRows}`}
        suffix={totalRows > 0 ? `(${matchedPct}%)` : undefined}
        severity={audit.join.severity}
      />
      <Chip
        label="Unmatched"
        value={`${audit.join.unmatchedRows}`}
        severity={audit.join.unmatchedRows > 0 ? 'warning' : 'ok'}
      />
      <Chip
        label="Duplicates"
        value={`${audit.join.duplicateKeys}`}
        severity={audit.join.duplicateKeys > 0 ? 'warning' : 'ok'}
      />
      <Chip
        label="Alignment"
        value={audit.support.alignmentClass}
        severity={audit.support.severity}
        wide
      />
      <Chip
        label="Support"
        value={audit.support.supportLabel}
        suffix={supportCoveragePct != null ? `(${supportCoveragePct}%)` : undefined}
        severity={audit.support.severity}
        wide
      />
    </section>
  );
}

function Chip({
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
  const severityClass =
    severity === 'error'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
      : severity === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        : 'border-border bg-background/60 text-foreground';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${severityClass} ${
        wide ? 'max-w-[260px]' : ''
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      <span
        className="font-medium tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      {suffix ? (
        <span
          className="text-muted-foreground tabular-nums"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

function toneClasses(state: WorkspaceReadiness['state']) {
  switch (state) {
    case 'ready':
      return {
        container:
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
        icon: 'text-emerald-500',
        label: 'text-emerald-700 dark:text-emerald-200',
      };
    case 'review':
      return {
        container:
          'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
        icon: 'text-amber-500',
        label: 'text-amber-700 dark:text-amber-200',
      };
    case 'blocked':
    default:
      return {
        container:
          'border-rose-500/40 bg-rose-500/10 text-rose-900 dark:text-rose-100',
        icon: 'text-rose-500',
        label: 'text-rose-700 dark:text-rose-200',
      };
  }
}

function stateIcon(state: WorkspaceReadiness['state']) {
  return function Icon({ className }: { className?: string }) {
    if (state === 'ready') {
      return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8" cy="8" r="7" />
          <path d="M5 8.5l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (state === 'review') {
      return (
        <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 1.5L15 14H1L8 1.5z" strokeLinejoin="round" />
          <path d="M8 6v4" strokeLinecap="round" />
          <circle cx="8" cy="12" r="0.6" fill="currentColor" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="7" />
        <path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round" />
      </svg>
    );
  };
}
