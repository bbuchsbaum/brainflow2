import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { PlotModeContext } from "../plotHost.types";
import type { SampleFrame } from "@/plotting";
import type { ActiveCohort } from "../cohortPlot.helpers";

const { cohortRef, sampleMock } = vi.hoisted(() => ({
  cohortRef: { current: null as ActiveCohort | null },
  sampleMock: vi.fn(),
}));

vi.mock("../cohortPlot.helpers", () => ({
  useActiveCohort: () => cohortRef.current,
  getActiveCohort: () => cohortRef.current,
}));

vi.mock("@/services/SampleProvider", () => ({
  sampleProvider: { sample: sampleMock },
}));

import { CohortPlotBody } from "../CohortPlot";
import { cohortPlot } from "../cohortPlot.mode";

const COHORT: ActiveCohort = {
  setId: "set-1",
  setName: "Demo",
  members: [
    { memberId: "sub01", sourcePath: "/a.nii" },
    { memberId: "sub02", sourcePath: "/b.nii" },
    { memberId: "sub03", sourcePath: "/c.nii" },
  ],
  // `subject` is a per-member identifier; `group` is the real factor (repeats).
  designTable: {
    columns: ["subject", "group"],
    rows: [
      { id: "sub01", cells: ["sub01", "ctrl"] },
      { id: "sub02", cells: ["sub02", "ctrl"] },
      { id: "sub03", cells: ["sub03", "pt"] },
    ],
  },
  designColumns: ["subject", "group"],
};

const baseFrame: SampleFrame = {
  columns: [
    { name: "member", role: "nominal" },
    { name: "value", role: "quantitative" },
  ],
  rows: [
    { member: "sub01", value: 1 },
    { member: "sub02", value: 2 },
    { member: "sub03", value: 3 },
  ],
};

function ctxFor(overrides: Partial<PlotModeContext> = {}): PlotModeContext {
  return {
    layerId: undefined,
    layerName: undefined,
    crosshairMm: [10, 20, 30],
    width: 400,
    height: 300,
    ...overrides,
  };
}

describe("cohortPlot.supports", () => {
  beforeEach(() => {
    sampleMock.mockReset();
    cohortRef.current = COHORT;
  });

  it("unsupported when no cohort is active", () => {
    cohortRef.current = null;
    expect(cohortPlot.supports(ctxFor())).toMatchObject({
      supported: false,
      reason: "unsupported-layer",
    });
  });

  it("no-crosshair when the crosshair is unset", () => {
    expect(
      cohortPlot.supports(ctxFor({ crosshairMm: undefined })),
    ).toMatchObject({
      supported: false,
      reason: "no-crosshair",
    });
  });

  it("supported with an active cohort + crosshair", () => {
    expect(cohortPlot.supports(ctxFor())).toEqual({ supported: true });
  });

  it("uses the reactive ctx.hasCohort even when getActiveCohort is null", () => {
    cohortRef.current = null; // store says no cohort
    expect(cohortPlot.supports(ctxFor({ hasCohort: true }))).toEqual({
      supported: true,
    });
  });
});

describe("CohortPlotBody", () => {
  beforeEach(() => {
    sampleMock.mockReset();
    cohortRef.current = COHORT;
  });

  it("samples the set locus at the crosshair and renders the joined plot", async () => {
    sampleMock.mockResolvedValue(baseFrame);
    render(<CohortPlotBody ctx={ctxFor()} />);

    await waitFor(() => expect(sampleMock).toHaveBeenCalledTimes(1));
    expect(sampleMock).toHaveBeenCalledWith({
      datasetId: "set-1",
      locus: {
        kind: "set",
        worldMm: [10, 20, 30],
        radiusMm: 0,
        members: COHORT.members,
      },
      reduce: "mean",
    });
    await waitFor(() =>
      expect(screen.getByTestId("encoded-plot-view")).toBeInTheDocument(),
    );
    // Default groups by `group` (the real factor), not the `subject` id -> box.
    await waitFor(() =>
      expect(screen.getByTestId("plot-encoder")).toHaveAttribute(
        "data-mark",
        "box",
      ),
    );
  });

  it("debounces rapid crosshair changes into a single cohort sample", async () => {
    sampleMock.mockResolvedValue(baseFrame);
    const { rerender } = render(
      <CohortPlotBody ctx={ctxFor({ crosshairMm: [1, 1, 1] })} />,
    );
    // Five rapid (synchronous) crosshair moves within the debounce window.
    for (let i = 2; i <= 6; i += 1) {
      rerender(<CohortPlotBody ctx={ctxFor({ crosshairMm: [i, i, i] })} />);
    }
    // Only the settled (final) position should sample.
    await waitFor(() => expect(sampleMock).toHaveBeenCalledTimes(1));
    expect(sampleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        locus: expect.objectContaining({ worldMm: [6, 6, 6] }),
      }),
    );
  });
});
