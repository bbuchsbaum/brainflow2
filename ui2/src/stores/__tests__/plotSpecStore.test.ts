import { describe, expect, it, beforeEach } from "vitest";

import { usePlotSpecStore } from "@/stores/plotSpecStore";

const M = "mode-x";

describe("plotSpecStore", () => {
  beforeEach(() => {
    usePlotSpecStore.getState().resetPlotSpecStore();
  });

  it("setSphereRadiusMm clamps negatives and keys by mode", () => {
    usePlotSpecStore.getState().setSphereRadiusMm(M, -4);
    expect(usePlotSpecStore.getState().sphereRadiusMmByMode[M]).toBe(0);
    usePlotSpecStore.getState().setSphereRadiusMm(M, 6);
    expect(usePlotSpecStore.getState().sphereRadiusMmByMode[M]).toBe(6);
  });

  it("setReduce keys by mode", () => {
    usePlotSpecStore.getState().setReduce(M, "median");
    expect(usePlotSpecStore.getState().reduceByMode[M]).toBe("median");
  });

  it("setMark stores a partial override", () => {
    usePlotSpecStore.getState().setMark(M, "point");
    expect(usePlotSpecStore.getState().specByMode[M]).toEqual({
      mark: "point",
    });
  });

  it("setEncodingChannel binds, then clears with null", () => {
    usePlotSpecStore.getState().setEncodingChannel(M, "y", "value");
    expect(usePlotSpecStore.getState().specByMode[M].encoding).toEqual({
      y: "value",
    });
    usePlotSpecStore.getState().setEncodingChannel(M, "y", null);
    expect(usePlotSpecStore.getState().specByMode[M].encoding).toEqual({
      y: "",
    });
  });

  it("resetMode drops only the visual override, not the locus params", () => {
    usePlotSpecStore.getState().setMark(M, "bar");
    usePlotSpecStore.getState().setSphereRadiusMm(M, 4);
    usePlotSpecStore.getState().resetMode(M);
    expect(usePlotSpecStore.getState().specByMode[M]).toBeUndefined();
    expect(usePlotSpecStore.getState().sphereRadiusMmByMode[M]).toBe(4);
  });

  it("is compare-before-write: re-setting the same mark keeps the map reference", () => {
    usePlotSpecStore.getState().setMark(M, "point");
    const before = usePlotSpecStore.getState().specByMode;
    usePlotSpecStore.getState().setMark(M, "point");
    expect(usePlotSpecStore.getState().specByMode).toBe(before);
  });

  it("setNormalize sets, replaces, and clears a normalize transform on a field", () => {
    usePlotSpecStore.getState().setNormalize(M, "value", "zscore");
    expect(usePlotSpecStore.getState().specByMode[M].transforms).toEqual([
      { kind: "normalize", field: "value", method: "zscore" },
    ]);
    usePlotSpecStore.getState().setNormalize(M, "value", "percentChange");
    expect(usePlotSpecStore.getState().specByMode[M].transforms).toEqual([
      { kind: "normalize", field: "value", method: "percentChange" },
    ]);
    usePlotSpecStore.getState().setNormalize(M, "value", null);
    expect(usePlotSpecStore.getState().specByMode[M].transforms).toEqual([]);
  });
});
