import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { PlotEncodingPanel } from "../PlotEncodingPanel";
import { usePlotSpecStore } from "@/stores/plotSpecStore";
import { column } from "@/plotting";
import type { SampleFrame } from "@/plotting";

const frame: SampleFrame = {
  columns: [column("t", "temporal"), column("value", "quantitative")],
  rows: [{ t: 0, value: 1 }],
  meta: { suggested: { mark: "line", encoding: { x: "t", y: "value" } } },
};

const richFrame: SampleFrame = {
  columns: [
    column("t", "temporal"),
    column("value", "quantitative"),
    column("group", "nominal"),
  ],
  rows: [{ t: 0, value: 1, group: "a" }],
  meta: { suggested: { mark: "line", encoding: { x: "t", y: "value" } } },
};

const M = "test-mode";

function optionValues(label: string): (string | null)[] {
  const select = screen.getByLabelText(label);
  return within(select)
    .getAllByRole("option")
    .map((o) => o.getAttribute("value"));
}

describe("PlotEncodingPanel", () => {
  beforeEach(() => {
    usePlotSpecStore.getState().resetPlotSpecStore();
  });

  it("switches the mark through the store", () => {
    render(<PlotEncodingPanel modeId={M} frame={frame} />);
    fireEvent.change(screen.getByLabelText("Plot mark"), {
      target: { value: "point" },
    });
    expect(usePlotSpecStore.getState().specByMode[M]?.mark).toBe("point");
  });

  it("rebinds the Y channel through the store", () => {
    render(<PlotEncodingPanel modeId={M} frame={frame} />);
    fireEvent.change(screen.getByLabelText("Y channel"), {
      target: { value: "t" },
    });
    expect(usePlotSpecStore.getState().specByMode[M]?.encoding?.y).toBe("t");
  });

  it("sets the sphere radius when locus controls are shown", () => {
    render(<PlotEncodingPanel modeId={M} frame={frame} showLocus />);
    fireEvent.change(screen.getByLabelText("Sampling radius"), {
      target: { value: "4" },
    });
    expect(usePlotSpecStore.getState().sphereRadiusMmByMode[M]).toBe(4);
  });

  it("hides locus controls by default", () => {
    render(<PlotEncodingPanel modeId={M} frame={frame} />);
    expect(screen.queryByLabelText("Sampling radius")).toBeNull();
  });

  it("excludes non-numeric columns from the X channel for a continuous mark", () => {
    render(<PlotEncodingPanel modeId={M} frame={richFrame} />);
    const xOpts = optionValues("X channel");
    expect(xOpts).toContain("t");
    expect(xOpts).toContain("value");
    expect(xOpts).not.toContain("group");
  });

  it("offers a Color channel only when categorical columns exist", () => {
    const { unmount } = render(
      <PlotEncodingPanel modeId={M} frame={richFrame} />,
    );
    expect(screen.getByLabelText("Color channel")).toBeInTheDocument();
    unmount();
    render(<PlotEncodingPanel modeId={M} frame={frame} />);
    expect(screen.queryByLabelText("Color channel")).toBeNull();
  });

  it("sets a normalize transform on the y field for a continuous mark", () => {
    render(<PlotEncodingPanel modeId={M} frame={frame} />);
    fireEvent.change(screen.getByLabelText("Normalize"), {
      target: { value: "zscore" },
    });
    expect(usePlotSpecStore.getState().specByMode[M]?.transforms).toEqual([
      { kind: "normalize", field: "value", method: "zscore" },
    ]);
  });
});
