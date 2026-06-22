import { describe, expect, it } from "vitest";

import {
  applyTransforms,
  boxStats,
  column,
  linearFit,
  quantileSorted,
} from "@/plotting";
import type { SampleFrame } from "@/plotting";

describe("quantileSorted", () => {
  it("linearly interpolates between samples", () => {
    expect(quantileSorted([0, 10], 0.5)).toBe(5);
    expect(quantileSorted([0, 10, 20, 30], 0.25)).toBeCloseTo(7.5);
    expect(quantileSorted([42], 0.9)).toBe(42);
  });
});

describe("boxStats", () => {
  it("computes quartiles, median and whiskers", () => {
    const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(s.median).toBe(5);
    expect(s.q1).toBe(3);
    expect(s.q3).toBe(7);
    expect(s.whiskerLo).toBe(1);
    expect(s.whiskerHi).toBe(9);
    expect(s.outliers).toEqual([]);
    expect(s.count).toBe(9);
  });

  it("flags outliers beyond 1.5·IQR and clamps the whisker", () => {
    const s = boxStats([1, 2, 3, 4, 5, 100])!;
    expect(s.outliers).toContain(100);
    expect(s.whiskerHi).toBeLessThan(100);
  });

  it("drops non-finite values and returns null when empty", () => {
    expect(boxStats([NaN, Infinity])).toBeNull();
    expect(boxStats([NaN, 2, 4])!.count).toBe(2);
  });
});

describe("linearFit", () => {
  it("fits a perfect line (slope, intercept, r²=1)", () => {
    const fit = linearFit([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ])!;
    expect(fit.slope).toBeCloseTo(2);
    expect(fit.intercept).toBeCloseTo(1);
    expect(fit.r2).toBeCloseTo(1);
  });

  it("returns null for <2 points or no x variance", () => {
    expect(linearFit([{ x: 1, y: 2 }])).toBeNull();
    expect(
      linearFit([
        { x: 1, y: 2 },
        { x: 1, y: 5 },
      ]),
    ).toBeNull();
  });
});

describe("applyTransforms — normalize", () => {
  const frame: SampleFrame = {
    columns: [column("t", "temporal"), column("value", "quantitative")],
    rows: [
      { t: 0, value: 0 },
      { t: 1, value: 10 },
      { t: 2, value: 20 },
    ],
  };

  it("z-scores a quantitative column in place (mean 0)", () => {
    const f = applyTransforms(frame, [
      { kind: "normalize", field: "value", method: "zscore" },
    ]);
    const vals = f.rows.map((r) => r.value as number);
    expect(vals.reduce((a, b) => a + b, 0) / vals.length).toBeCloseTo(0);
    expect(vals[1]).toBeCloseTo(0);
    expect(vals[0]).toBeCloseTo(-1.2247, 3);
  });

  it("percent-changes relative to the column mean", () => {
    const f = applyTransforms(frame, [
      { kind: "normalize", field: "value", method: "percentChange" },
    ]);
    const vals = f.rows.map((r) => r.value as number);
    expect(vals[0]).toBeCloseTo(-100);
    expect(vals[2]).toBeCloseTo(100);
  });

  it("no-ops on a non-quantitative field and passes through with no transforms", () => {
    expect(
      applyTransforms(frame, [
        { kind: "normalize", field: "t", method: "zscore" },
      ]).rows.map((r) => r.t),
    ).toEqual([0, 1, 2]);
    expect(applyTransforms(frame)).toBe(frame);
  });
});
