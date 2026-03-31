/**
 * BidsSummaryStrip
 * Horizontal row of summary metrics for a scanned BIDS dataset.
 * Layout: flex-row with 24px gap, wrapping. Each metric is a stacked label/value group.
 * No borders on individual items — space is the separator.
 */

import React from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDatasetSummary } from '@/stores/bidsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatTasks(taskIds: string[]): string {
  if (taskIds.length === 0) return 'None';
  if (taskIds.length <= 3) return taskIds.join(', ');
  return `${taskIds.slice(0, 3).join(', ')} +${taskIds.length - 3} more`;
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

type DotColor = 'green' | 'red' | 'amber';

const dotColors: Record<DotColor, string> = {
  green: 'var(--app-success)',
  red: 'var(--app-error)',
  amber: 'var(--app-warning)',
};

interface StatusDotProps {
  color: DotColor;
}

function StatusDot({ color }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: dotColors[color],
        marginRight: '5px',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// MetricGroup — stacked label + value, no decorative border
// ---------------------------------------------------------------------------

interface MetricGroupProps {
  label: string;
  children: React.ReactNode;
}

function MetricGroup({ label, children }: MetricGroupProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}
    >
      <span
        className="bf-role-section text-muted-foreground"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        className="bf-role-value text-foreground"
        style={{
          fontSize: '13px',
          fontWeight: 500,
          tabularNums: 'normal',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {children}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation metric
// ---------------------------------------------------------------------------

interface ValidationMetricProps {
  validation: BidsDatasetSummary['validation'];
}

function ValidationMetric({ validation }: ValidationMetricProps) {
  if (validation.passed) {
    return (
      <>
        <StatusDot color="green" />
        Passed
      </>
    );
  }
  if (validation.critical_count > 0) {
    return (
      <>
        <StatusDot color="red" />
        {validation.critical_count} critical
      </>
    );
  }
  return (
    <>
      <StatusDot color="amber" />
      {validation.warning_count} warnings
    </>
  );
}

// ---------------------------------------------------------------------------
// BidsSummaryStrip
// ---------------------------------------------------------------------------

export function BidsSummaryStrip() {
  const summary = useBidsStore((state) => state.summary);

  if (!summary) return null;

  const sessionLabel =
    summary.session_ids.length === 0
      ? 'None'
      : String(summary.session_ids.length);

  const modalitiesLabel =
    summary.modalities.length === 0
      ? '—'
      : summary.modalities.join(' ');

  return (
    <div
      className="border-b border-border"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '24px',
        paddingInline: '16px',
        paddingBlock: '8px',
        minHeight: 0,
        maxHeight: '48px',
        overflow: 'hidden',
      }}
      aria-label="BIDS dataset summary"
    >
      <MetricGroup label="Subjects">
        {summary.subject_count}
      </MetricGroup>

      <MetricGroup label="Sessions">
        {sessionLabel}
      </MetricGroup>

      <MetricGroup label="Tasks">
        {formatTasks(summary.task_ids)}
      </MetricGroup>

      <MetricGroup label="Modalities">
        {modalitiesLabel}
      </MetricGroup>

      <MetricGroup label="Size">
        {formatBytes(summary.total_size_bytes)}
      </MetricGroup>

      <MetricGroup label="Validation">
        <ValidationMetric validation={summary.validation} />
      </MetricGroup>
    </div>
  );
}
