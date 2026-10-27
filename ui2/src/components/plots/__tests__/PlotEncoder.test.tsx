import { describe, expect, it, vi } from "vitest";
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

describe("axis craft for series (phase 4 v1 F6)", () => {
  const diff: SampleFrame = {
    columns: [column("lag", "quantitative"), column("value", "quantitative")],
    rows: [0, 1, 2, 3, 4, 5, 6, 7].map((lag) => ({ lag, value: lag - 3 })),
    meta: { suggested: { mark: "line", encoding: { x: "lag", y: "value" } } },
  };
  it("draws axis titles, every integer lag tick including the last, and a zero line", () => {
    const spec = resolveSpec(diff);
    render(
      <PlotEncoder
        frame={diff}
        spec={{ ...spec, params: { ...spec.params, xTitle: "Lag (TR)", yTitle: "β (a.u.)", xIntegerTicks: true, xPadHalfStep: 1, zeroLine: true } }}
        width={500}
        height={220}
      />,
    );
    expect(screen.getByTestId("plot-x-title")).toHaveTextContent("Lag (TR)");
    expect(screen.getByTestId("plot-y-title")).toHaveTextContent("β (a.u.)");
    expect(screen.getByTestId("plot-zero-line")).toBeInTheDocument();
    const ticks = Array.from(document.querySelectorAll(".visx-axis-bottom .visx-axis-tick text")).map((el) => el.textContent);
    expect(ticks).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });
});

describe("datum links: one tab stop, roving keys (phase 4 v1 function 3/6)", () => {
  const twoLines: SampleFrame = {
    columns: [column("x", "quantitative"), column("value", "quantitative"), column("g", "nominal"), column("id", "nominal")],
    rows: ["a", "b"].flatMap((g) => [0, 1, 2].map((x) => ({ x, value: x + (g === "b" ? 5 : 0), g, id: `${g}${x}` }))),
    meta: { suggested: { mark: "line", encoding: { x: "x", y: "value", color: "g", detail: "g" } } },
  };
  it("frame stepping: ArrowRight moves focus AND activates; keys do not leak; no aria-pressed when not selectable", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onFocus = vi.fn();
    const outer = vi.fn();
    const spec = resolveSpec(twoLines);
    render(
      <div onKeyDown={outer}>
        <PlotEncoder
          frame={twoLines}
          spec={spec}
          width={400}
          height={200}
          context={{
            datumLink: {
              idColumn: "id",
              focusedId: "a1",
              selectedIds: new Set(["a0", "a1", "a2", "b0", "b1", "b2"]),
              onFocus,
              onToggleSelection: () => undefined,
              selectable: false,
              activateOnMove: true,
              label: (i) => `point ${twoLines.rows[i].id}`,
            },
          }}
        />
      </div>,
    );
    const points = Array.from(document.querySelectorAll("[data-datum-id]"));
    expect(points.filter((p) => p.getAttribute("tabindex") === "0").map((p) => p.getAttribute("data-datum-id"))).toEqual(["a1"]);
    expect(points.every((p) => !p.hasAttribute("aria-pressed"))).toBe(true);
    const a1 = document.querySelector('[data-datum-id="a1"]') as SVGElement;
    expect(a1.getAttribute("aria-label")).toBe("point a1");
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    expect(onFocus).toHaveBeenLastCalledWith("a2");
    expect(document.activeElement?.getAttribute("data-datum-id")).toBe("a2");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-datum-id")).toBe("b2");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(onFocus).toHaveBeenLastCalledWith("b0");
    expect(outer).not.toHaveBeenCalled();
  });
});
