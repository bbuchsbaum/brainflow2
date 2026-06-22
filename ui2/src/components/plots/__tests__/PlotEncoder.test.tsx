import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PlotEncoder } from "../encoder/PlotEncoder";
import { column, resolveSpec } from "@/plotting";
import type { PlotSpec, SampleFrame } from "@/plotting";

const lineFrame: SampleFrame = {
  columns: [column("t", "temporal"), column("value", "quantitative")],
  rows: [
    { t: 0, value: 1 },
    { t: 1, value: 3 },
    { t: 2, value: 2 },
  ],
  meta: { suggested: { mark: "line", encoding: { x: "t", y: "value" } } },
};

function renderEncoder(frame: SampleFrame, override?: Partial<PlotSpec>) {
  const spec = resolveSpec(frame, override);
  return render(
    <PlotEncoder frame={frame} spec={spec} width={300} height={150} />,
  );
}

describe("PlotEncoder", () => {
  it("dispatches a line frame to the line mark", () => {
    renderEncoder(lineFrame);
    expect(screen.getByTestId("plot-encoder")).toHaveAttribute(
      "data-mark",
      "line",
    );
    expect(screen.getByTestId("plot-mark-line")).toBeInTheDocument();
  });

  it("honours a mark override (line -> point)", () => {
    renderEncoder(lineFrame, { mark: "point" });
    expect(screen.getByTestId("plot-encoder")).toHaveAttribute(
      "data-mark",
      "point",
    );
    expect(screen.getByTestId("plot-mark-point")).toBeInTheDocument();
  });

  it("shows a message for an empty cartesian frame", () => {
    renderEncoder({ ...lineFrame, rows: [] });
    expect(screen.getByTestId("plot-encoder-message")).toBeInTheDocument();
    expect(screen.queryByTestId("plot-mark-line")).toBeNull();
  });

  it("renders a box mark for a grouped (nominal × quantitative) frame", () => {
    const boxFrame: SampleFrame = {
      columns: [column("group", "nominal"), column("value", "quantitative")],
      rows: [
        { group: "a", value: 1 },
        { group: "a", value: 2 },
        { group: "a", value: 3 },
        { group: "b", value: 5 },
        { group: "b", value: 6 },
      ],
    };
    renderEncoder(boxFrame);
    expect(screen.getByTestId("plot-encoder")).toHaveAttribute(
      "data-mark",
      "box",
    );
    expect(screen.getByTestId("plot-mark-box")).toBeInTheDocument();
  });

  it("renders a scatter with an lmFit transform without crashing", () => {
    const scatterFrame: SampleFrame = {
      columns: [column("age", "quantitative"), column("value", "quantitative")],
      rows: [
        { age: 1, value: 2 },
        { age: 2, value: 4 },
        { age: 3, value: 6 },
      ],
    };
    renderEncoder(scatterFrame, {
      mark: "point",
      transforms: [{ kind: "lmFit", x: "age", y: "value" }],
    });
    expect(screen.getByTestId("plot-mark-point")).toBeInTheDocument();
  });

  it("renders a bar with a categorical x-axis", () => {
    const barFrame: SampleFrame = {
      columns: [column("region", "nominal"), column("value", "quantitative")],
      rows: [
        { region: "Aaa", value: 1 },
        { region: "Bbb", value: 2 },
      ],
      meta: {
        suggested: { mark: "bar", encoding: { x: "region", y: "value" } },
      },
    };
    renderEncoder(barFrame);
    expect(screen.getByTestId("plot-mark-bar")).toBeInTheDocument();
    // The categorical x-axis must render its tick labels (the bug: BarMark
    // never passed xScale, so AxisBottom was omitted). visx also keeps a hidden
    // text-measurement node, so there may be >1 match per label.
    expect(screen.getAllByText("Aaa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bbb").length).toBeGreaterThan(0);
  });
});
