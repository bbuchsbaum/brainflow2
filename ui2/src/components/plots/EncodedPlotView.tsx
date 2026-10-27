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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { focusFallback } from "@/components/ui/bf";

import { resolveSpec } from "@/plotting";
import type { SampleFrame } from "@/plotting";
import { usePlotSpecStore } from "@/stores/plotSpecStore";

import { PlotEncoder } from "./encoder/PlotEncoder";
import type { EncoderContext } from "./encoder/types";
import { PlotEncodingPanel } from "./PlotEncodingPanel";
import { MARK_LABELS } from "./encoder/markLabels";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/shadcn/popover";

/** Height (px) of the caption row for marks without a header line. */
const CAPTION_ROW_HEIGHT = 20;
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
  /** Extra mark params (axis titles, integer ticks …) merged over the resolved spec's. */
  readonly params?: Readonly<Record<string, unknown>>;
}

export function EncodedPlotView({
  modeId,
  frame,
  width,
  height,
  context,
  showLocus,
  showReduce,
  params,
}: EncodedPlotViewProps) {
  const override = usePlotSpecStore((s) => s.specByMode[modeId]);
  const spec = useMemo(() => {
    const resolved = resolveSpec(frame, override);
    return params ? { ...resolved, params: { ...resolved.params, ...params } } : resolved;
  }, [frame, override, params]);

  const areaRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Changing the mark moves the caption (over the plot for a histogram, in
  // its own row otherwise), which closes the popover with focus on <body>:
  // put it back on the caption.
  const lastMark = useRef(spec.mark);
  useEffect(() => {
    if (lastMark.current === spec.mark) return;
    lastMark.current = spec.mark;
    focusFallback([() => rootRef.current?.querySelector<HTMLElement>('[data-testid="plot-encoding-caption"]')]);
  }, [spec.mark]);
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

  // The histogram has a header line of its own (top margin): the caption
  // sits in it, over the chart. Other marks get a slim caption row.
  const overlayCaption = spec.mark === "hist";
  const encoderWidth = measured?.width ?? width;
  const encoderHeight =
    measured?.height ??
    Math.max(height - (overlayCaption ? 0 : CAPTION_ROW_HEIGHT), MIN_ENCODER_HEIGHT);
  const caption = [
    MARK_LABELS[spec.mark] ?? spec.mark,
    [spec.encoding.x, spec.encoding.y].filter(Boolean).join(" × "),
  ]
    .filter(Boolean)
    .join(" · ");

  // Data first (P3.12): the encoding is a one-line mono caption; clicking it
  // opens the Mark / X / Y (and sampling) selects in a popover.
  const captionButton = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 max-w-full items-center gap-1 truncate rounded-bf-xs px-1 font-mono text-bf-2xs text-bf-text-muted hover:bg-accent hover:text-bf-text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
          aria-label={`Plot encoding: ${caption}. Change`}
          data-testid="plot-encoding-caption"
        >
          <span className="truncate">{caption}</span>
          <span aria-hidden>▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-auto max-w-[480px] p-1"
        aria-label="Plot encoding"
      >
        <PlotEncodingPanel
          modeId={modeId}
          frame={frame}
          showLocus={showLocus}
          showReduce={showReduce}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      ref={rootRef}
      data-testid="encoded-plot-view"
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        minHeight: 0,
      }}
    >
      {overlayCaption ? null : (
        <div style={{ height: CAPTION_ROW_HEIGHT, display: "flex", alignItems: "center" }}>
          {captionButton}
        </div>
      )}
      <div
        ref={areaRef}
        style={{ flex: "1 1 auto", minHeight: 0, position: "relative" }}
      >
        {overlayCaption ? (
          <div style={{ position: "absolute", left: 8, top: 2, zIndex: 2, maxWidth: "50%" }}>
            {captionButton}
          </div>
        ) : null}
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
