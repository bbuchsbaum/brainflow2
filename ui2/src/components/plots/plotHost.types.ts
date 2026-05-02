/**
 * Plot Host Contract — Phase 4a of the integrated workspace refactor.
 *
 * The PlotHost is a generic plot shell. It owns the mode selector, sizing,
 * loading/error/empty-state machine, and toolbar layout. It owns NOTHING
 * specific to a particular plot kind (histogram, time series, etc.) — those
 * live behind the `PlotMode` boundary defined here.
 *
 * Plot-mode boundary:
 *   - A `PlotMode` is a self-contained unit of plot logic registered with the
 *     host via `PlotHostProps.modes`. The host treats modes as opaque.
 *   - Modes report whether they can render in a given `PlotModeContext` via
 *     `supports(ctx)`. The host renders an appropriate state when the answer
 *     is `{ supported: false, reason }`, and only calls `render(ctx)` when
 *     the mode declares itself supported.
 *   - Modes may contribute a small toolbar fragment via `toolbar(ctx)`. Host
 *     chrome (mode selector, sizing) is never duplicated by modes.
 *
 * Phase 4b registers `HistogramPlot`; Phase 4c registers
 * `CrosshairTimeSeriesPlot`. Future modes (ROI mean, event-aligned response,
 * spectrum, design matrix) plug in the same way.
 */

import type { ReactNode } from 'react';

/** Reason a plot mode cannot render in the current context. */
export type PlotModeUnsupportedReason =
  | 'no-layer'
  | 'unsupported-layer'
  | 'no-crosshair';

/** Result returned by `PlotMode.supports`. */
export type PlotModeSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: PlotModeUnsupportedReason; readonly message?: string };

/** Context passed to a plot mode's lifecycle methods. */
export interface PlotModeContext {
  /** Currently selected layer id, or `undefined` when no layer is selected. */
  readonly layerId: string | undefined;
  /** Display name for the selected layer. */
  readonly layerName: string | undefined;
  /** Crosshair world-mm position, or `undefined` when no crosshair is set. */
  readonly crosshairMm: readonly [number, number, number] | undefined;
  /** Allocated drawing area (px) for the mode body, after host chrome. */
  readonly width: number;
  readonly height: number;
}

/** A registered plot mode. The host treats this as opaque content. */
export interface PlotMode {
  /** Stable identifier, e.g. `'histogram'`. */
  readonly id: string;
  /** Short label shown in the mode selector. */
  readonly label: string;
  /** Reports whether this mode can render in the given context. */
  supports(ctx: PlotModeContext): PlotModeSupport;
  /** Renders the mode body. Only invoked when `supports(ctx).supported === true`. */
  render(ctx: PlotModeContext): ReactNode;
  /** Optional toolbar fragment shown to the right of the mode selector. */
  toolbar?(ctx: PlotModeContext): ReactNode;
}

/** Props accepted by `PlotHost`. */
export interface PlotHostProps {
  /** Registered plot modes. Order determines mode-selector order. */
  readonly modes: readonly PlotMode[];
  /** Controlled current mode id. If omitted, the host manages selection internally. */
  readonly modeId?: string;
  /** Initial mode id when uncontrolled. Falls back to `modes[0]?.id`. */
  readonly defaultModeId?: string;
  /** Notified when the active mode changes (controlled or uncontrolled). */
  onModeChange?: (id: string) => void;

  /** Currently selected layer id; passed through to mode contexts. */
  readonly layerId?: string;
  /** Display name for the selected layer. */
  readonly layerName?: string;
  /** Crosshair world-mm position; passed through to mode contexts. */
  readonly crosshairMm?: readonly [number, number, number];

  /** When true, the host renders its loading state and skips mode rendering. */
  readonly loading?: boolean;
  /** When set, the host renders its error state and skips mode rendering. */
  readonly error?: Error | null;

  /** Optional className appended to the host root. */
  readonly className?: string;
}
