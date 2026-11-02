/**
 * Layout pieces for direction H's round-5 workflow states, built from H's
 * own parts so the states read as the same product: the primary panel (two
 * header lines, the image, the ruler, an optional banner above the image and
 * a bar below it), the orthogonal column, a bottom dock, and the side sheet.
 *
 * Sheets (AI licence, save, setup) replace the orthogonal column and the
 * Inspector, never the primary: nothing is drawn over the anatomy the
 * session is about, and the primary keeps its exact view.
 */

import React from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Chip, IconButton } from '@/components/ui/bf';
import { SliceView, type Projector } from '@/modules/segmentation/components/shared/SliceView';
import { ViewportFrame } from '@/modules/segmentation/components/shared/chrome';
import type { PanelProps } from '@/modules/segmentation/components/shared/views';
import { OrthoHeader } from '@/modules/segmentation/components/directions/h/DirectionH';
import { hOrtho } from '@/modules/segmentation/components/directions/h/hViews';

/** A status chip in the primary header (one per state, `data-testid="status-chip"`). */
export function StateChip({ children, icon, title }: { children: React.ReactNode; icon?: React.ReactNode; title?: string }) {
  return (
    <Chip icon={icon} title={title} data-testid="status-chip">
      {children}
    </Chip>
  );
}

/** H's primary panel with slots. */
export function PrimaryPanel({
  chip,
  title,
  right,
  line2,
  line2Right,
  view,
  overlay,
  ruler,
  banner,
  below,
  ariaLabel = 'Primary tracing view',
  grid = false,
}: {
  chip?: React.ReactNode;
  title: React.ReactNode;
  right?: React.ReactNode;
  line2?: React.ReactNode;
  /** Round 6: the inline key at the right of header line 2 (island ring, prompt forms). */
  line2Right?: React.ReactNode;
  view: PanelProps;
  overlay?: (p: Projector) => React.ReactNode;
  ruler?: React.ReactNode;
  banner?: React.ReactNode;
  below?: React.ReactNode;
  ariaLabel?: string;
  grid?: boolean;
}) {
  return (
    <section aria-label={ariaLabel} className="flex min-h-0 min-w-0 flex-col bg-bf-bg-canvas" data-testid="primary-panel">
      <div className="relative z-10 flex shrink-0 flex-col border-b border-bf-border-subtle bg-bf-bg-panel-sunken">
        <div className="flex h-7 items-center gap-2 px-2">
          {chip}
          {title}
          {right ? <span className="ml-auto flex shrink-0 items-center gap-1.5">{right}</span> : null}
        </div>
        {line2 ? (
          <div className="flex h-6 items-center gap-2 px-1.5">
            {line2}
            {line2Right ? <span className="ml-auto flex shrink-0 items-center">{line2Right}</span> : null}
          </div>
        ) : null}
      </div>
      {banner}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <SliceView {...view} grid={grid} aria-label={ariaLabel} overlay={overlay} />
        </div>
        {ruler}
      </div>
      {below}
    </section>
  );
}

/** H's orthogonal column (axial over sagittal, CA1 only, gutters), as while tracing. */
export function OrthoColumn({ axial, sagittal }: { axial?: React.ReactNode; sagittal?: React.ReactNode }) {
  const o = hOrtho('tracing');
  return (
    <div className="grid min-h-0 grid-rows-2 gap-px">
      {axial ?? (
        <ViewportFrame image={o.axial.image} title={<OrthoHeader image={o.axial.image} />}>
          <SliceView {...o.axial} />
        </ViewportFrame>
      )}
      {sagittal ?? (
        <ViewportFrame image={o.sagittal.image} title={<OrthoHeader image={o.sagittal.image} />}>
          <SliceView {...o.sagittal} />
        </ViewportFrame>
      )}
    </div>
  );
}

/** The Trace grid: primary | orthogonal column, and an optional dock across both. */
export function TraceGrid({ primary, side, dock, dockHeight = 248 }: { primary: React.ReactNode; side?: React.ReactNode; dock?: React.ReactNode; dockHeight?: number }) {
  return (
    <div
      className="grid h-full min-h-0 gap-px bg-bf-border-subtle"
      style={{
        gridTemplateColumns: side ? 'minmax(0,1fr) var(--h-ortho)' : 'minmax(0,1fr)',
        gridTemplateRows: dock ? `minmax(0,1fr) ${dockHeight}px` : 'minmax(0,1fr)',
      }}
    >
      {primary}
      {side ?? null}
      {dock ? <div className={clsx('min-h-0', side && 'col-span-2')}>{dock}</div> : null}
    </div>
  );
}

/**
 * A side sheet: the width of the orthogonal column plus the Inspector, in
 * their place. A title row with close, a scrolling body, a footer of actions.
 */
export function SideSheet({
  title,
  meta,
  children,
  footer,
  testId,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId: string;
}) {
  return (
    <aside
      aria-label={typeof title === 'string' ? title : 'Sheet'}
      className="flex w-[calc(var(--h-ortho)+var(--h-inspector)+1px)] shrink-0 flex-col border-l border-bf-border-subtle bg-bf-bg-panel"
      data-testid={testId}
      data-sheet
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-bf-border-subtle px-3">
        <span className="text-bf-sm font-semibold text-bf-text-primary">{title}</span>
        {meta ? <span className="truncate text-bf-2xs text-bf-text-muted">{meta}</span> : null}
        <IconButton aria-label="Close" title="Close (Esc)" icon={<X />} size="sm" variant="ghost" className="ml-auto" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer ? <div className="flex shrink-0 items-center gap-1.5 border-t border-bf-border-subtle px-3 py-2">{footer}</div> : null}
    </aside>
  );
}

/** A numbered part of a sheet. */
export function SheetPart({ n, title, meta, children, testId }: { n?: number; title: string; meta?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 border-b border-bf-border-subtle px-3 py-2.5" data-testid={testId}>
      <div className="flex items-baseline gap-2">
        {n ? <span className="font-mono text-bf-2xs text-bf-text-muted">{n}</span> : null}
        <h3 className="m-0 text-bf-xs font-semibold text-bf-text-primary">{title}</h3>
        {meta ? <span className="ml-auto text-bf-2xs text-bf-text-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A choice row with a radio mark (sheets): selected rows get the neutral selected edge, not colour. */
export function ChoiceRow({
  selected,
  title,
  detail,
  children,
  testId,
  disabled,
}: {
  selected: boolean;
  title: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={selected ? 0 : -1}
      className={clsx(
        'flex cursor-pointer gap-2 rounded-sm border px-2 py-1.5',
        selected ? 'border-bf-border-strong bg-bf-bg-active' : 'border-bf-border-subtle hover:bg-bf-bg-hover',
        disabled && 'opacity-50',
      )}
      data-testid={testId}
      data-selected={selected || undefined}
    >
      <span
        className={clsx('mt-[3px] flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-bf-text-primary' : 'border-bf-text-muted')}
        aria-hidden
      >
        {selected ? <span className="h-1 w-1 rounded-full bg-bf-text-primary" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-bf-xs text-bf-text-primary">{title}</span>
        {detail ? <span className="text-bf-2xs text-bf-text-secondary">{detail}</span> : null}
        {children}
      </span>
    </div>
  );
}

/** Mono preview of a file's first lines. */
export function FilePreview({ lines, max = 4, testId }: { lines: readonly string[]; max?: number; testId?: string }) {
  return (
    <pre
      style={{ tabSize: 14 }}
      className="m-0 overflow-hidden whitespace-pre rounded-sm border border-bf-border-subtle bg-bf-bg-canvas px-2 py-1 font-mono text-bf-2xs leading-4 text-bf-text-secondary"
      data-testid={testId}
    >
      {lines.slice(0, max).join('\n')}
      {lines.length > max ? `\n… ${lines.length - max} more` : ''}
    </pre>
  );
}
