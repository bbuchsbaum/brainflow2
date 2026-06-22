/**
 * InlineHistogramPreview — renders a tiny sparkline from cached histogram data
 * and hands off to the dock on click. It must degrade silently (render
 * nothing) when there is no usable distribution or the fetch fails, so it
 * never shows broken chrome.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { HistogramData } from "@/types/histogram";

const computeHistogram = vi.fn();
vi.mock("@/services/HistogramService", () => ({
  histogramService: {
    computeHistogram: (...args: unknown[]) => computeHistogram(...args),
  },
}));

import { InlineHistogramPreview } from "../InlineHistogramPreview";

function histogramWith(norms: number[]): HistogramData {
  return {
    bins: norms.map((n, i) => ({
      x0: i,
      x1: i + 1,
      count: Math.round(n * 100),
      normalizedCount: n,
      percentage: n * 10,
    })),
    totalCount: 1000,
    minValue: 0,
    maxValue: norms.length,
    mean: 1,
    std: 1,
    binCount: norms.length,
    layerId: "L",
  };
}

describe("InlineHistogramPreview", () => {
  beforeEach(() => {
    computeHistogram.mockReset();
  });

  it("renders a sparkline with one bar per bin", async () => {
    computeHistogram.mockResolvedValue(histogramWith([0.2, 1, 0.5, 0.1]));
    render(<InlineHistogramPreview layerId="L" onOpen={() => {}} />);

    const preview = await screen.findByTestId("inline-histogram-preview");
    expect(preview.querySelectorAll("rect")).toHaveLength(4);
  });

  it("invokes onOpen when clicked", async () => {
    const onOpen = vi.fn();
    computeHistogram.mockResolvedValue(histogramWith([0.5, 1]));
    render(<InlineHistogramPreview layerId="L" onOpen={onOpen} />);

    fireEvent.click(await screen.findByTestId("inline-histogram-preview"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the histogram fetch fails", async () => {
    computeHistogram.mockRejectedValue(new Error("no backend"));
    render(<InlineHistogramPreview layerId="L" onOpen={() => {}} />);

    await waitFor(() => expect(computeHistogram).toHaveBeenCalled());
    expect(screen.queryByTestId("inline-histogram-preview")).toBeNull();
  });

  it("renders nothing when the distribution is empty", async () => {
    computeHistogram.mockResolvedValue(histogramWith([0, 0, 0]));
    render(<InlineHistogramPreview layerId="L" onOpen={() => {}} />);

    await waitFor(() => expect(computeHistogram).toHaveBeenCalled());
    expect(screen.queryByTestId("inline-histogram-preview")).toBeNull();
  });

  it("renders a non-interactive readout (no button) when onOpen is omitted", async () => {
    computeHistogram.mockResolvedValue(histogramWith([0.3, 1, 0.4]));
    render(<InlineHistogramPreview layerId="L" />);

    const preview = await screen.findByTestId("inline-histogram-preview");
    expect(preview.tagName).toBe("DIV");
    expect(preview.querySelector("button")).toBeNull();
    expect(preview.querySelectorAll("rect")).toHaveLength(3);
  });
});
