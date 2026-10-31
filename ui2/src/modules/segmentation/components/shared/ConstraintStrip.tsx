/**
 * The constraint strip (research contract 2): the active label and every
 * constraint the next stroke obeys, in Plex Mono, always visible. When a
 * stroke is refused the strip says why, with the counts the gate produced.
 */

import React from 'react';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/bf';
import { LensBadge, Swatch } from './chrome';
import { LABEL_BY_ID } from './mockData';

export interface ConstraintStripProps {
  label: number;
  paintOver?: string;
  shape?: '2D' | '3D';
  diameterMm?: number;
  range?: string | null;
  /** View-only lens in force on this view ("unsharp"), or null for raw. */
  lens?: string | null;
  /** A refused stroke: replaces the strip with the reason. */
  blocked?: { reason: string; detail: string; action?: string } | null;
  /** `bar`: viewport header; `float`: on the canvas (black translucent ground). */
  variant?: 'bar' | 'float' | 'plain';
  /** Hide the label (when the label is shown next to the strip already). */
  hideLabel?: boolean;
  className?: string;
}

function Sep() {
  return <span className="text-bf-text-faint">·</span>;
}

export function ConstraintStrip({
  label,
  paintOver = 'over unlocked',
  shape = '2D',
  diameterMm = 3,
  range = null,
  lens = null,
  blocked = null,
  variant = 'bar',
  hideLabel = false,
  className,
}: ConstraintStripProps) {
  const def = LABEL_BY_ID.get(label);
  const ground =
    variant === 'float'
      ? 'rounded-sm bg-bf-bg-canvas/80 px-2 py-0.5 border border-bf-border-subtle'
      : variant === 'bar'
        ? ''
        : '';

  if (blocked) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="constraint-strip"
        data-blocked="true"
        className={clsx(
          'flex min-w-0 items-center gap-2 whitespace-nowrap font-mono text-bf-xs',
          variant === 'float'
            ? 'rounded-sm border border-bf-warning/60 bg-bf-bg-canvas/90 px-2 py-0.5'
            : 'border-l-2 border-bf-warning pl-2',
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-bf-warning" aria-hidden />
        <span className="shrink-0 text-bf-text-primary">{blocked.reason}</span>
        <Sep />
        <span className="min-w-0 truncate text-bf-text-secondary">{blocked.detail}</span>
        {blocked.action ? (
          <Button variant="link" size="sm" className="font-sans">
            {blocked.action}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-testid="constraint-strip"
      aria-label="Active constraints"
      className={clsx('flex min-w-0 items-center gap-1.5 whitespace-nowrap font-mono text-bf-xs text-bf-text-secondary', ground, className)}
    >
      {!hideLabel && def ? (
        <span className="flex items-center gap-1.5 text-bf-text-primary">
          <Swatch color={def.color} size={8} />
          {def.name}
        </span>
      ) : null}
      {!hideLabel ? <Sep /> : null}
      <span>{paintOver}</span>
      <Sep />
      <span>{shape}</span>
      <Sep />
      <span>⌀ {diameterMm.toFixed(1)} mm</span>
      <Sep />
      <span>{range ? `range ${range}` : 'range off'}</span>
      {lens ? (
        <>
          <Sep />
          <LensBadge>{lens}</LensBadge>
        </>
      ) : null}
    </div>
  );
}
