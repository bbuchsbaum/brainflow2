import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { PlotModeContext } from "../plotHost.types";
import type { SampleFrame } from "@/plotting";

const { layerState, sampleMock } = vi.hoisted(() => ({
  layerState: {
    current: {} as {
      layers: { id: string; type?: string; atlasMetadata?: unknown }[];
      getLayer: (id: string) => unknown;
    },
  },
  sampleMock: vi.fn(),
}));

vi.mock("@/stores/layerStore", () => {
  const useLayerStore = (<T,>(selector: (s: typeof layerState.current) => T) =>
    selector(layerState.current)) as unknown as {
    <T>(selector: (s: typeof layerState.current) => T): T;
    getState: () => typeof layerState.current;
  };
  useLayerStore.getState = () => layerState.current;
  return { useLayerStore };
});

vi.mock("@/services/SampleProvider", () => ({
  sampleProvider: { sample: sampleMock },
}));

import { RegionStatsPlotBody } from "../RegionStatsPlot";
import { regionStatsPlot } from "../regionStatsPlot.mode";

function ctxFor(overrides: Partial<PlotModeContext> = {}): PlotModeContext {
  return {
    layerId: "scalar-1",
    layerName: "scalar-1",
    crosshairMm: undefined,
    width: 400,
    height: 300,
    ...overrides,
  };
}

function setLayers(scalarType: string | undefined, withAtlas: boolean) {
  const layers: { id: string; type?: string; atlasMetadata?: unknown }[] = [
    { id: "scalar-1", type: scalarType },
  ];
  if (withAtlas)
    layers.push({
      id: "atlas-1",
      type: "label",
      atlasMetadata: { id: "schaefer" },
    });
  layerState.current = {
    layers,
    getLayer: (id: string) => layers.find((l) => l.id === id),
  };
}

const regionFrame: SampleFrame = {
  columns: [
    { name: "region", role: "nominal" },
    { name: "value", role: "quantitative" },
    { name: "voxelCount", role: "quantitative" },
  ],
  rows: [
    { region: "A", value: 0.5, voxelCount: 10 },
    { region: "B", value: 0.8, voxelCount: 20 },
  ],
  meta: { suggested: { mark: "bar", encoding: { x: "region", y: "value" } } },
};

describe("regionStatsPlot.supports", () => {
  beforeEach(() => sampleMock.mockReset());

  it("reports no-layer when no layer is selected", () => {
    setLayers("anatomical", true);
    expect(
      regionStatsPlot.supports(ctxFor({ layerId: undefined })),
    ).toMatchObject({
      supported: false,
      reason: "no-layer",
    });
  });

  it("reports unsupported when the active layer is itself an atlas", () => {
    setLayers("label", true);
    layerState.current.layers[0] = {
      id: "scalar-1",
      type: "label",
      atlasMetadata: { id: "x" },
    };
    expect(regionStatsPlot.supports(ctxFor())).toMatchObject({
      supported: false,
      reason: "unsupported-layer",
    });
  });

  it("reports unsupported when no atlas layer is loaded", () => {
    setLayers("anatomical", false);
    expect(regionStatsPlot.supports(ctxFor())).toMatchObject({
      supported: false,
      reason: "unsupported-layer",
    });
  });

  it("is supported with a scalar active layer + a loaded atlas", () => {
    setLayers("anatomical", true);
    expect(regionStatsPlot.supports(ctxFor())).toEqual({ supported: true });
  });

  it("uses the reactive ctx.atlasLayerId even when the store has no atlas", () => {
    setLayers("anatomical", false); // no atlas in the store
    expect(
      regionStatsPlot.supports(ctxFor({ atlasLayerId: "atlas-1" })),
    ).toEqual({ supported: true });
  });
});

describe("RegionStatsPlotBody", () => {
  beforeEach(() => {
    sampleMock.mockReset();
    setLayers("anatomical", true);
  });

  it("samples the regions locus over the active atlas", async () => {
    sampleMock.mockResolvedValue(regionFrame);
    render(<RegionStatsPlotBody ctx={ctxFor()} />);

    await waitFor(() => expect(sampleMock).toHaveBeenCalledTimes(1));
    expect(sampleMock).toHaveBeenCalledWith({
      datasetId: "scalar-1",
      locus: { kind: "regions", atlasLayerId: "atlas-1" },
      reduce: "mean",
    });
    await waitFor(() =>
      expect(screen.getByTestId("encoded-plot-view")).toBeInTheDocument(),
    );
  });
});
