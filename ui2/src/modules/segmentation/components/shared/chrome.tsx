/**
 * Shell pieces the directions share: a stand-in for the app frame (top bar,
 * status bar) so mocks read in context, the viewport frame with its header
 * line, key hints and swatches. Tokens only; colour appears only in swatches.
 */

import React from 'react';
import clsx from 'clsx';
import { LayoutGrid } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/bf';
import { fmtMm, PLANE_AXIS, PLANE_NAME, slicePositionMm } from './geometry';
import type { SliceImage } from './types';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-bf-border px-1 font-mono text-bf-2xs leading-none text-bf-text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A label's colour square. `ring` marks the active label (neutral, never amber). */
export function Swatch({
  color,
  size = 10,
  dashed,
  className,
}: {
  color: string;
  size?: number;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block shrink-0 rounded-sm', dashed && 'border border-dashed', className)}
      style={
        dashed
          ? { width: size, height: size, borderColor: color, backgroundColor: 'transparent' }
          : { width: size, height: size, backgroundColor: color }
      }
    />
  );
}

/** Line sample for legends: solid or dashed, in a data colour or neutral. */
export function LineSample({ dashed, color, width = 18 }: { dashed?: boolean; color?: string; width?: number }) {
  return (
    <svg width={width} height={8} aria-hidden className="shrink-0">
      <line
        x1={1}
        y1={4}
        x2={width - 1}
        y2={4}
        strokeWidth={1.75}
        strokeDasharray={dashed ? '4 3' : undefined}
        className={color ? undefined : 'stroke-bf-text-primary'}
        style={color ? { stroke: color } : undefined}
      />
    </svg>
  );
}

/** The honest disclosure: what is real and what is mocked in these screens. */
export function MockDisclosure({ className }: { className?: string }) {
  return (
    <span className={clsx('whitespace-nowrap text-bf-2xs text-bf-text-faint', className)}>
      Design mock · editing simulated · MNI152 2009c T2w/T1w 1 mm · subfield labels mock
    </span>
  );
}

export interface ShellFrameProps {
  /** Centre of the top bar (workspace switcher or breadcrumb). */
  center?: React.ReactNode;
  right?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  /** `quiet` drops the top bar to a breadcrumb line (direction B). */
  topBar?: 'default' | 'quiet';
}

/** A stand-in for the app shell around the module (top bar, status bar). */
export function ShellFrame({ center, right, status, children, topBar = 'default' }: ShellFrameProps) {
  return (
    <div className="flex h-screen w-screen min-w-0 flex-col overflow-hidden bg-bf-bg-app font-sans text-bf-text-primary">
      <header
        className={clsx(
          'relative flex shrink-0 items-center gap-3 border-b border-bf-border-subtle bg-bf-bg-shell px-3',
          topBar === 'quiet' ? 'h-8' : 'h-10',
        )}
      >
        <div className="flex items-center gap-2 text-bf-sm font-semibold">
          <LayoutGrid className="h-4 w-4 text-bf-text-secondary" aria-hidden />
          Brainflow
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{center}</div>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-bf-border-subtle bg-bf-bg-shell px-3 text-bf-xs">
        <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">{status}</div>
        <MockDisclosure />
      </footer>
    </div>
  );
}

/** The app's display-mode switcher with the Trace preset. */
export function ModeSwitcher({ value }: { value: string }) {
  return (
    <SegmentedControl
      aria-label="Display mode"
      size="md"
      edge="accent"
      activation="manual"
      value={value}
      onValueChange={() => undefined}
      options={[
        { value: 'orthogonal', label: 'Orthogonal' },
        { value: 'mosaic', label: 'Mosaic' },
        { value: 'compare', label: 'Compare' },
        { value: 'trace', label: 'Trace' },
      ]}
    />
  );
}

/** Status bar label + value pair. */
export function StatusItem({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-bf-text-muted">{label}</span>
      <span className={clsx('text-bf-text-primary', mono && 'font-mono')}>{value}</span>
    </span>
  );
}

/** "Coronal  y −22.0 mm  T2w" */
export function SliceTitle({ image, className, showContrast = true }: { image: SliceImage; className?: string; showContrast?: boolean }) {
  return (
    <span className={clsx('flex min-w-0 items-baseline gap-2 whitespace-nowrap text-bf-xs', className)}>
      <span className="text-bf-text-primary">{PLANE_NAME[image.plane]}</span>
      <span className="font-mono text-bf-text-secondary">
        {PLANE_AXIS[image.plane]} {fmtMm(slicePositionMm(image.plane, image.index))} mm
      </span>
      {showContrast ? <span className="text-bf-text-secondary">{image.contrast}</span> : null}
    </span>
  );
}

/** A view-only badge for filtered contrasts (never written to). */
export function LensBadge({ children = 'View only' }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 items-center rounded-sm border border-bf-border-strong px-1 text-bf-2xs text-bf-text-secondary">
      {children}
    </span>
  );
}

export interface ViewportFrameProps {
  image: SliceImage;
  /** Right side of the header line. */
  headerRight?: React.ReactNode;
  /** Replace the default title. */
  title?: React.ReactNode;
  /** `bar`: a header row above the image; `overlay`: text on the canvas (no row). */
  header?: 'bar' | 'overlay' | 'none';
  /** Neutral selected edge for the focused (primary) view. */
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** A viewport: header line plus the slice. */
export function ViewportFrame({
  image,
  headerRight,
  title,
  header = 'bar',
  active,
  children,
  className,
}: ViewportFrameProps) {
  return (
    <section
      aria-label={`${image.plane} view`}
      className={clsx(
        'relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-bf-bg-canvas',
        active ? 'outline outline-1 -outline-offset-1 outline-bf-border-strong' : null,
        className,
      )}
    >
      {header === 'bar' ? (
        <div className="flex h-7 shrink-0 items-center gap-3 border-b border-bf-border-subtle bg-bf-bg-panel-sunken px-2">
          <div className="flex shrink-0 items-center">{title ?? <SliceTitle image={image} />}</div>
          <div className="ml-auto flex min-w-0 items-center justify-end gap-2 overflow-hidden">{headerRight}</div>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {children}
        {header === 'overlay' ? (
          <div className="pointer-events-none absolute left-2 right-2 top-1.5 flex items-start gap-3">
            {title ?? <SliceTitle image={image} className="[text-shadow:0_0_3px_black]" />}
            <div className="pointer-events-auto ml-auto flex min-w-0 items-center gap-2">{headerRight}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
