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
  };
  readonly intensityWindow?: [number, number];
  readonly threshold?: [number, number];
  readonly colormap?: string;
  readonly useLogScale?: boolean;
  readonly onIntensityChange?: (window: [number, number]) => void;
  readonly onThresholdChange?: (threshold: [number, number]) => void;
  readonly onLogScaleChange?: (useLogScale: boolean) => void;
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
