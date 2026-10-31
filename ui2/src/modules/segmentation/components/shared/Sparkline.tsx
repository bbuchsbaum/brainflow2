/**
 * A per-slice sparkline that doubles as navigation: one column per native
 * slice, a line of the value (label area, or disagreeing voxels), the
 * current slice as a hairline with a caret, and the clickable slices as
 * baseline ticks. Clicking a column jumps to that slice; the hovered column
 * is the click target. Achromatic except an optional data colour.
 */

import React from 'react';
import clsx from 'clsx';

export interface SparklineProps {
  values: readonly number[];
  /** Index of the current slice. */
  current?: number;
  /** Index of the hovered column (the click target). */
  hover?: number;
  width?: number;
  height?: number;
  /** Data colour of the line (a label colour); neutral by default. */
  color?: string;
  /** Accessible name ("CA1 area by slice"). */
  label: string;
  /** Called with the slice index a click lands on. */
  onPick?: (index: number) => void;
  /** Mark columns (e.g. flagged slices) with a stronger baseline tick. */
  marks?: readonly number[];
  /**
   * `line` (default): a line of the value. `bars`: one stepped bar per slice
   * with a gap between slices, so a slice with no value is a visible hole
   * (a smoothed line would hide it).
   */
  variant?: 'line' | 'bars';
  className?: string;
}

export function Sparkline({
  values,
  current,
  hover,
  width = 64,
  height = 16,
  color,
  label,
  onPick,
  marks = [],
  variant = 'line',
  className,
}: SparklineProps) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const col = width / Math.max(1, n);
  const x = (i: number) => (i + 0.5) * col;
  const top = 3;
  const base = height - 3;
  const y = (v: number) => base - (v / max) * (base - top);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join('');
  const area = `${d}L${x(n - 1).toFixed(2)} ${base}L${x(0).toFixed(2)} ${base}Z`;
  return (
    <button
      type="button"
      aria-label={`${label}; click a slice to go there`}
      title={`${label} · click to go to a slice`}
      className={clsx('group inline-flex shrink-0 cursor-pointer rounded-sm p-0 hover:bg-bf-bg-hover', className)}
      onClick={(e) => {
        if (!onPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
      }}
      tabIndex={-1}
    >
      <svg width={width} height={height} aria-hidden className="block overflow-visible">
        {hover !== undefined ? (
          <rect x={hover * col} y={0} width={col} height={height} className="fill-bf-text-primary" fillOpacity={0.18} data-hover />
        ) : null}
        {values.map((_, i) => (
          <line
            key={i}
            x1={x(i)}
            x2={x(i)}
            y1={height - 1.5}
            y2={height}
            className={marks.includes(i) ? 'stroke-bf-text-secondary' : 'stroke-bf-text-faint'}
            strokeWidth={1}
          />
        ))}
        {variant === 'bars' ? (
          <g data-bars>
            {values.map((v, i) =>
              v > 0 ? (
                <rect
                  key={i}
                  x={i * col + 0.5}
                  width={Math.max(1, col - 1)}
                  y={y(v)}
                  height={base - y(v)}
                  className={color ? undefined : 'fill-bf-text-secondary'}
                  style={color ? { fill: color } : undefined}
                  fillOpacity={0.85}
                />
              ) : null,
            )}
          </g>
        ) : (
          <>
            <path d={area} className={color ? undefined : 'fill-bf-text-secondary'} style={color ? { fill: color } : undefined} fillOpacity={0.18} />
            <path
              d={d}
              fill="none"
              className={color ? undefined : 'stroke-bf-text-secondary'}
              style={color ? { stroke: color } : undefined}
              strokeWidth={1.25}
              strokeLinejoin="round"
            />
          </>
        )}
        {current !== undefined ? (
          <g data-current>
            <line x1={x(current)} x2={x(current)} y1={1} y2={height} className="stroke-bf-text-primary" strokeWidth={1} />
            {variant === 'line' ? <circle cx={x(current)} cy={y(values[current] ?? 0)} r={1.75} className="fill-bf-text-primary" /> : null}
          </g>
        ) : null}
      </svg>
    </button>
  );
}
