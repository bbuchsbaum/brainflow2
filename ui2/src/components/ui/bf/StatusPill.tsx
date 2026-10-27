import React, { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, Check, Clock, Loader2, Minus } from 'lucide-react';
import { cn } from '@/utils/cn';
import { jobStateLabel, jobStateStatus, type StatusKind } from './helpers';
import { H_TAG } from './states';

/**
 * Status as icon + text, 20px (`H_TAG`). Semantic states (success, warning,
 * failed) add a tinted hairline; neutral states (running, queued, cancelled,
 * unknown) are icon + muted text only, with NO border, so a status can never
 * be mistaken for a FilterChip toggle. No fill: colour is status, never an
 * area. The one exception is `blocking` on a failed state (an error that
 * stops the user), which adds the soft danger fill.
 *
 * Glyphs: running = spinner (animates only when motion is allowed), queued =
 * clock, success = check, failed = alert circle, warning = triangle,
 * cancelled / unknown = dash.
 *
 * `JobStatusPill` (analysis job states) is this pill with the job-state
 * vocabulary; it is re-exported from `components/analysis/JobStatusPill`.
 */


export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusKind;
  /** Visible text; defaults to the status name in sentence case. */
  children?: React.ReactNode;
  /** Replace the status icon, or `false` for none. */
  icon?: React.ReactNode | false;
  /** Soft danger fill for a blocking failure. */
  blocking?: boolean;
}

const STATUS_LABEL: Record<StatusKind, string> = {
  success: 'Completed',
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  cancelled: 'Cancelled',
  warning: 'Warning',
  neutral: 'Unknown',
};

const pillVariants = cva(
  cn(
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-bf-xs font-medium',
    H_TAG,
  ),
  {
    variants: {
      status: {
        success: 'border-bf-success/40 text-bf-success',
        running: 'border-0 px-0 text-bf-text-secondary',
        queued: 'border-0 px-0 text-bf-text-secondary',
        failed: 'border-destructive/50 text-bf-danger',
        cancelled: 'border-0 px-0 text-muted-foreground',
        warning: 'border-bf-warning/50 text-bf-warning',
        neutral: 'border-0 px-0 text-muted-foreground',
      },
      blocking: { true: '', false: '' },
    },
    compoundVariants: [{ status: 'failed', blocking: true, className: 'bg-bf-danger-soft' }],
    defaultVariants: { status: 'neutral', blocking: false },
  },
);

function statusIcon(status: StatusKind): React.ReactNode {
  const cls = 'h-3 w-3';
  switch (status) {
    case 'success':
      return <Check className={cls} aria-hidden />;
    case 'failed':
      return <AlertCircle className={cls} aria-hidden />;
    case 'warning':
      return <AlertTriangle className={cls} aria-hidden />;
    case 'running':
      return <Loader2 className={cn(cls, 'motion-safe:animate-spin')} aria-hidden />;
    case 'queued':
      return <Clock className={cls} aria-hidden />;
    default:
      return <Minus className={cls} aria-hidden />;
  }
}

export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(function StatusPill(
  { status, children, icon, blocking = false, className, ...rest },
  ref,
) {
  const iconNode = icon === false ? null : (icon ?? statusIcon(status));
  return (
    <span
      ref={ref}
      data-status={status}
      className={cn(pillVariants({ status, blocking: blocking && status === 'failed' }), className)}
      {...rest}
    >
      {iconNode}
      {children ?? STATUS_LABEL[status]}
    </span>
  );
});

// ── analysis job states ─────────────────────────────────────────────────────

/** One job-state treatment for the Analysis Workbench and Inspector. */
export function JobStatusPill({ state, className }: { state: string; className?: string }) {
  return (
    <StatusPill status={jobStateStatus(state)} data-job-state={state} className={className}>
      {jobStateLabel(state)}
    </StatusPill>
  );
}
