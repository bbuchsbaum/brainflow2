import React from 'react';
import { AlertCircle, Check, Loader2, Minus } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * One job-state treatment shared by the Analysis Workbench and the Analysis
 * Inspector. Status is carried by a coloured icon + text and a hairline edge;
 * there is no soft fill (HYBRID rule: colour is status, never an area).
 */
export function jobStateLabel(state: string): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Unknown';
  }
}

export function JobStatusPill({ state, className }: { state: string; className?: string }) {
  let tone: string;
  let icon: React.ReactNode;
  switch (state) {
    case 'completed':
      tone = 'border-bf-success/40 text-bf-success';
      icon = <Check className="h-3 w-3" aria-hidden />;
      break;
    case 'failed':
      tone = 'border-destructive/50 text-bf-danger';
      icon = <AlertCircle className="h-3 w-3" aria-hidden />;
      break;
    case 'running':
    case 'queued':
      tone = 'border-border text-bf-text-secondary';
      icon = (
        <Loader2 className={cn('h-3 w-3', state === 'running' && 'animate-spin')} aria-hidden />
      );
      break;
    default:
      tone = 'border-border text-muted-foreground';
      icon = <Minus className="h-3 w-3" aria-hidden />;
  }

  return (
    <span
      data-job-state={state}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-bf-xs font-medium',
        tone,
        className,
      )}
    >
      {icon}
      {jobStateLabel(state)}
    </span>
  );
}
