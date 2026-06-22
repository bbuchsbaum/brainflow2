/**
 * PlotEncoder — renders a {@link SampleFrame} according to a
 * {@link ResolvedPlotSpec} by dispatching on `spec.mark` to a mark renderer.
 *
 * This is the single rendering seam for every plot: histogram, time-series and
 * (future) by-factor / covariate / ROI plots all flow through here. Adding a
 * plot type is adding a mark renderer to the registry + an inference rule —
 * never a new bespoke chart component wired into a mode.
 */

import { useMemo, type ReactNode } from "react";

import { applyTransforms } from "@/plotting";
import type { ResolvedPlotSpec, SampleFrame } from "@/plotting";

import { MARK_RENDERERS } from "./registry";
import type { EncoderContext } from "./types";

export interface PlotEncoderProps {
  readonly frame: SampleFrame;
  readonly spec: ResolvedPlotSpec;
  readonly width: number;
  readonly height: number;
  readonly context?: EncoderContext;
}

function EncoderMessage({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="plot-encoder-message"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        fontSize: 12,
        color: "var(--app-text-muted)",
      }}
    >
      {children}
    </div>
  );
}

export function PlotEncoder({
  frame,
  spec,
  width,
  height,
  context,
}: PlotEncoderProps) {
  const Mark = MARK_RENDERERS[spec.mark];
  // The hist mark owns its own loading/empty/error states (via HistogramChart),
  // so it renders even for an empty frame; cartesian marks need rows.
  const isHist = spec.mark === "hist";

  // Apply frame transforms (e.g. normalize) before encoding. The hist mark
  // reads its rich payload from meta, so leave its frame untransformed.
  const renderFrame = useMemo(
    () => (isHist ? frame : applyTransforms(frame, spec.transforms)),
    [isHist, frame, spec.transforms],
  );

  let body: ReactNode;
  if (!Mark) {
    body = (
      <EncoderMessage>Mark “{spec.mark}” is not available.</EncoderMessage>
    );
  } else if (!isHist && renderFrame.rows.length === 0) {
    body = <EncoderMessage>No data to plot.</EncoderMessage>;
  } else {
    body = (
      <Mark
        frame={renderFrame}
        spec={spec}
        width={width}
        height={height}
        context={context}
      />
    );
  }

  return (
    <div
      data-testid="plot-encoder"
      data-mark={spec.mark}
      style={{ width, height, overflow: "hidden" }}
    >
      {body}
    </div>
  );
}

export default PlotEncoder;
