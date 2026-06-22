import { describe, expect, it } from "vitest";

import {
  column,
  columnValues,
  columnsByRole,
  frameFromScalar,
  frameFromSeries,
  getColumn,
  inferRole,
  numericColumn,
} from "@/plotting";
import type { SampleFrame } from "@/plotting";

describe("frame helpers", () => {
  const frame: SampleFrame = {
    columns: [
      column("t", "temporal", { unit: "s" }),
      column("value", "quantitative"),
      column("group", "nominal"),
    ],
    rows: [
      { t: 0, value: 1.5, group: "a" },
      { t: 1, value: 2.5, group: "b" },
    ],
  };

  it("column() builds a descriptor with optional unit/labels", () => {
    expect(column("t", "temporal")).toEqual({ name: "t", role: "temporal" });
    expect(column("t", "temporal", { unit: "s" })).toEqual({
      name: "t",
      role: "temporal",
      unit: "s",
    });
  });

  it("getColumn finds a column by name", () => {
    expect(getColumn(frame, "value")?.role).toBe("quantitative");
    expect(getColumn(frame, "missing")).toBeUndefined();
  });

  it("columnsByRole filters by one or more roles", () => {
    expect(columnsByRole(frame, "quantitative").map((c) => c.name)).toEqual([
      "value",
    ]);
    expect(
      columnsByRole(frame, "temporal", "nominal").map((c) => c.name),
    ).toEqual(["t", "group"]);
  });

  it("columnValues / numericColumn extract in row order", () => {
    expect(columnValues(frame, "group")).toEqual(["a", "b"]);
    expect(numericColumn(frame, "value")).toEqual([1.5, 2.5]);
    // Non-numeric cells become NaN, preserving row alignment.
    expect(numericColumn(frame, "group").every((v) => Number.isNaN(v))).toBe(
      true,
    );
  });

  it("inferRole: all-numeric (or null) -> quantitative, else nominal", () => {
    expect(inferRole([1, 2, null])).toBe("quantitative");
    expect(inferRole([1, "x"])).toBe("nominal");
  });

  it("frameFromSeries builds (index, value) rows by default", () => {
    const f = frameFromSeries([10, 20, 30], { xName: "t", xRole: "temporal" });
    expect(f.columns.map((c) => [c.name, c.role])).toEqual([
      ["t", "temporal"],
      ["value", "quantitative"],
    ]);
    expect(f.rows).toEqual([
      { t: 0, value: 10 },
      { t: 1, value: 20 },
      { t: 2, value: 30 },
    ]);
  });

  it("frameFromSeries honours explicit xValues + unit", () => {
    const f = frameFromSeries([10, 20], {
      xName: "t",
      xRole: "temporal",
      xUnit: "s",
      xValues: [0, 2],
    });
    expect(getColumn(f, "t")?.unit).toBe("s");
    expect(f.rows).toEqual([
      { t: 0, value: 10 },
      { t: 2, value: 20 },
    ]);
  });

  it("frameFromScalar builds a single-row quantitative frame", () => {
    const f = frameFromScalar(42);
    expect(f.columns).toEqual([{ name: "value", role: "quantitative" }]);
    expect(f.rows).toEqual([{ value: 42 }]);
  });
});
