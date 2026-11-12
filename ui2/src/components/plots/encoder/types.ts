/**
 * Encoder contract: a mark renderer turns a (frame, resolved spec) pair into a
 * chart. Every mark — line, area, point, bar, hist — implements this same
 * interface, so {@link PlotEncoder} can dispatch purely on `spec.mark`.
 */

import type { ReactNode } from "react";

import type { ResolvedPlotSpec, SampleFrame } from "@/plotting";

/**
 * Optional extras a mode can thread to a mark that needs more than the frame —
 * notably the `hist` mark, which drives the existing interactive histogram
 * (intensity window / threshold drag, colormap gradient, log scale). Generic
 * cartesian marks ignore this.
 */
export interface EncoderContext {
  /** Link original row identities to focus/selection without changing plot data. */
  readonly datumLink?: {
    readonly idColumn: string;
    readonly focusedId: string | null;
    readonly selectedIds: ReadonlySet<string>;
    readonly onFocus: (id: string) => void;
    readonly onToggleSelection: (id: string) => void;
    /** False: points focus only (no Shift-click selection, no aria-pressed). Default true. */
    readonly selectable?: boolean;
    /** Arrow keys also activate (onFocus) the point they move to (frame stepping). */
    readonly activateOnMove?: boolean;
    /** Accessible name of a point (row index into the frame). */
    readonly label?: (rowIndex: number) => string;
    /**
     * Where Tab enters a set that does not hold the focused point (a facet):
     * the first point whose id is listed, else the first point.
     */
    readonly entryIds?: ReadonlySet<string>;
    /** What a click does, concretely ("Click to show this frame"); omitted: the tooltip is the label. */
    readonly action?: string;
    /** The point under the pointer (null when it leaves): presentation only, never focus. */
    readonly onHover?: (id: string | null) => void;
    /** A point another view marks (its hover): drawn with a light ring. */
    readonly linkedId?: string | null;
    /**
     * A point's mark as SVG path parts centred at (cx, cy), radius r (a group
     * mark), each filled or stroked; null or absent: the default dot. Opt-in.
     */
    readonly glyph?: (
      id: string,
      cx: number,
      cy: number,
      r: number,
    ) => readonly { readonly d: string; readonly filled: boolean }[] | null;
  };
  readonly intensityWindow?: [number, number];
  readonly threshold?: [number, number];
  readonly colormap?: string;
  readonly useLogScale?: boolean;
  readonly onIntensityChange?: (window: [number, number]) => void;
  readonly onThresholdChange?: (threshold: [number, number]) => void;
  readonly onLogScaleChange?: (useLogScale: boolean) => void;
  /** Histogram x-axis title (the statistic's variable). */
  readonly xTitle?: string | null;
  readonly loading?: boolean;
  readonly error?: Error | null;
}

/** Props every mark renderer receives. */
export interface MarkRenderProps {
  readonly frame: SampleFrame;
  readonly spec: ResolvedPlotSpec;
  /** Drawing area in px (already net of host chrome / body padding). */
  readonly width: number;
  readonly height: number;
  readonly context?: EncoderContext;
}

/** A mark renderer. Pure of side effects; returns the chart node. */
export type MarkRenderer = (props: MarkRenderProps) => ReactNode;
