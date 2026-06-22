/**
 * EncodedPlotView — the shared "params panel + chart" composition every plot
 * mode renders. Given a frame (already sampled by the mode's body) it resolves
 * the per-mode override into a concrete spec and draws the
 * {@link PlotEncodingPanel} above the {@link PlotEncoder}. Modes stay thin:
 * they own sampling; this owns rendering + the spec UI.
 *
 * The encoder area is measured (ResizeObserver) rather than assuming a fixed
 * panel height, so a panel that wraps to multiple rows on a narrow dock still
 * yields a correctly-sized, non-clipped chart. Before the first real
 * measurement (and in non-layout environments like jsdom, where
 * getBoundingClientRect is 0) it falls back to an estimate.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { resolveSpec } from "@/plotting";
import type { SampleFrame } from "@/plotting";
import { usePlotSpecStore } from "@/stores/plotSpecStore";

import { PlotEncoder } from "./encoder/PlotEncoder";
import type { EncoderContext } from "./encoder/types";
import { PlotEncodingPanel } from "./PlotEncodingPanel";

/** Estimated panel-strip height (px) used until the area is measured. */
const ESTIMATED_PANEL_HEIGHT = 30;
const MIN_ENCODER_HEIGHT = 40;

export interface EncodedPlotViewProps {
  readonly modeId: string;
  readonly frame: SampleFrame;
  readonly width: number;
  readonly height: number;
  readonly context?: EncoderContext;
  /** Show the spatial sampling controls in the panel (point/sphere loci). */
  readonly showLocus?: boolean;
  /** Show the reducer control in the panel (e.g. region sampling). */
  readonly showReduce?: boolean;
}

export function EncodedPlotView({
  modeId,
  frame,
  width,
  height,
  context,
  showLocus,
  showReduce,
}: EncodedPlotViewProps) {
  const override = usePlotSpecStore((s) => s.specByMode[modeId]);
  const spec = useMemo(() => resolveSpec(frame, override), [frame, override]);

  const areaRef = useRef<HTMLDivElement>(null);
  // null until a real (>0) measurement arrives; before that we use a live
  // estimate derived from the current props (so it never goes stale).
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      // Ignore zero/unlaid-out measurements (e.g. jsdom) — keep the estimate.
      if (w <= 0 || h <= 0) return;
      setMeasured((prev) =>
        prev && prev.width === w && prev.height === h
          ? prev
          : { width: w, height: h },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const encoderWidth = measured?.width ?? width;
  const encoderHeight =
    measured?.height ??
    Math.max(height - ESTIMATED_PANEL_HEIGHT, MIN_ENCODER_HEIGHT);

  return (
    <div
      data-testid="encoded-plot-view"
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        minHeight: 0,
      }}
    >
      <PlotEncodingPanel
        modeId={modeId}
        frame={frame}
        showLocus={showLocus}
        showReduce={showReduce}
      />
      <div
        ref={areaRef}
        style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}
      >
        <PlotEncoder
          frame={frame}
          spec={spec}
          width={encoderWidth}
          height={encoderHeight}
          context={context}
        />
      </div>
    </div>
  );
}

export default EncodedPlotView;
