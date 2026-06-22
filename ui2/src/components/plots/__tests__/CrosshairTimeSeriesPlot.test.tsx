import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import type { PlotModeContext } from "../plotHost.types";

const { invokeMock, layerStoreState, voxelTransformMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  layerStoreState: {
    current: {} as {
      getLayer: (id: string) => unknown;
      getLayerMetadata: (id: string) => unknown;
    },
  },
  voxelTransformMock: vi.fn(),
}));

vi.mock("@/services/transport", () => ({
  getTransport: () => ({ invoke: invokeMock }),
}));

vi.mock("@/utils/voxelTransform", () => ({
  transformWorldToVoxelColumnMajor: voxelTransformMock,
}));

vi.mock("@/stores/layerStore", () => {
  const useLayerStore = (() => layerStoreState.current) as unknown as {
    getState: () => typeof layerStoreState.current;
  };
  useLayerStore.getState = () => layerStoreState.current;
  return { useLayerStore };
});

import { CrosshairTimeSeriesPlotBody } from "../CrosshairTimeSeriesPlot";
import {
  resolveTimeseriesVoxel,
  isLayerFourD,
  TIMESERIES_THROTTLE_MS,
} from "../crosshairTimeSeriesPlot.helpers";
import { crosshairTimeSeriesPlot } from "../crosshairTimeSeriesPlot.mode";
import { usePlotSpecStore } from "@/stores/plotSpecStore";

const TIME_SERIES_MODE_ID = "crosshair-time-series";

function ctxFor(overrides: Partial<PlotModeContext> = {}): PlotModeContext {
  return {
    layerId: "vol-1",
    layerName: "vol-1",
    crosshairMm: [10, 20, 30],
    width: 400,
    height: 200,
    ...overrides,
  };
}

function setupFourDLayer(opts?: {
  dimensions?: [number, number, number];
  numTimepoints?: number;
}) {
  const dims = opts?.dimensions ?? [64, 64, 32];
  const numTp = opts?.numTimepoints ?? 100;
  layerStoreState.current = {
    getLayer: (id: string) =>
      id === "vol-1"
        ? {
            id,
            volumeId: "volume-handle-1",
            timeSeriesInfo: { num_timepoints: numTp },
          }
        : undefined,
    getLayerMetadata: (id: string) =>
      id === "vol-1"
        ? {
            worldToVoxel: "matrix-stub",
            dimensions: dims,
          }
        : undefined,
  };
}

function setupThreeDLayer() {
  layerStoreState.current = {
    getLayer: (id: string) =>
      id === "vol-1"
        ? {
            id,
            volumeId: "volume-handle-1",
            timeSeriesInfo: undefined,
          }
        : undefined,
    getLayerMetadata: (id: string) =>
      id === "vol-1"
        ? { worldToVoxel: "matrix-stub", dimensions: [64, 64, 32] }
        : undefined,
  };
}

describe("crosshairTimeSeriesPlot.supports", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    voxelTransformMock.mockReset();
    voxelTransformMock.mockReturnValue([10, 20, 15] as [
      number,
      number,
      number,
    ]);
  });

  it("reports no-layer when no layer is selected", () => {
    setupFourDLayer();
    expect(
      crosshairTimeSeriesPlot.supports(ctxFor({ layerId: undefined })),
    ).toMatchObject({
      supported: false,
      reason: "no-layer",
    });
  });

  it("reports unsupported-layer when the layer is 3D", () => {
    setupThreeDLayer();
    expect(crosshairTimeSeriesPlot.supports(ctxFor())).toMatchObject({
      supported: false,
      reason: "unsupported-layer",
    });
  });

  it("reports no-crosshair when 4D layer has no crosshair set", () => {
    setupFourDLayer();
    expect(
      crosshairTimeSeriesPlot.supports(ctxFor({ crosshairMm: undefined })),
    ).toMatchObject({
      supported: false,
      reason: "no-crosshair",
    });
  });

  it("reports supported for a 4D layer with crosshair", () => {
    setupFourDLayer();
    expect(crosshairTimeSeriesPlot.supports(ctxFor())).toEqual({
      supported: true,
    });
  });

  it("declares the time-series plot identity", () => {
    expect(crosshairTimeSeriesPlot.id).toBe("crosshair-time-series");
    expect(crosshairTimeSeriesPlot.label).toBe("Time Series");
  });
});

describe("resolveTimeseriesVoxel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    voxelTransformMock.mockReset();
  });

  it("returns null when crosshair is missing", () => {
    setupFourDLayer();
    expect(resolveTimeseriesVoxel("vol-1", undefined)).toBeNull();
  });

  it("returns null when the layer is 3D", () => {
    setupThreeDLayer();
    expect(resolveTimeseriesVoxel("vol-1", [10, 20, 30])).toBeNull();
  });

  it("returns null when world→voxel transform throws", () => {
    setupFourDLayer();
    voxelTransformMock.mockImplementation(() => {
      throw new Error("singular matrix");
    });
    expect(resolveTimeseriesVoxel("vol-1", [10, 20, 30])).toBeNull();
  });

  it("returns null when voxel is out of bounds", () => {
    setupFourDLayer({ dimensions: [10, 10, 10] });
    voxelTransformMock.mockReturnValue([20, 5, 5] as [number, number, number]);
    expect(resolveTimeseriesVoxel("vol-1", [10, 20, 30])).toBeNull();
  });

  it("returns rounded voxel coords plus volumeId for in-bounds 4D voxel", () => {
    setupFourDLayer({ dimensions: [64, 64, 32] });
    voxelTransformMock.mockReturnValue([10.4, 20.6, 15.5] as [
      number,
      number,
      number,
    ]);
    expect(resolveTimeseriesVoxel("vol-1", [1, 2, 3])).toEqual({
      volumeId: "volume-handle-1",
      voxel: [10, 21, 16],
    });
  });
});

describe("isLayerFourD", () => {
  it("is true for 4D layers and false otherwise", () => {
    setupFourDLayer();
    expect(isLayerFourD("vol-1")).toBe(true);
    setupThreeDLayer();
    expect(isLayerFourD("vol-1")).toBe(false);
    expect(isLayerFourD(undefined)).toBe(false);
  });
});

describe("CrosshairTimeSeriesPlotBody", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invokeMock.mockReset();
    voxelTransformMock.mockReset();
    voxelTransformMock.mockReturnValue([10, 20, 15] as [
      number,
      number,
      number,
    ]);
    setupFourDLayer();
    usePlotSpecStore.getState().resetPlotSpecStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues sample_stack with the point-locus request shape (radius 0)", async () => {
    invokeMock.mockResolvedValue([1, 2, 3, 4]);
    render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS + 1);
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("sample_stack", {
      layerId: "vol-1",
      worldMm: [10, 20, 30],
      radiusMm: 0,
      reduce: "mean",
    });
  });

  it("issues sample_stack with a sphere locus when a radius is configured", async () => {
    usePlotSpecStore.getState().setSphereRadiusMm(TIME_SERIES_MODE_ID, 4);
    invokeMock.mockResolvedValue([1, 2, 3, 4]);
    render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS + 1);
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("sample_stack", {
      layerId: "vol-1",
      worldMm: [10, 20, 30],
      radiusMm: 4,
      reduce: "mean",
    });
  });

  it("renders the SVG line plot once data arrives", async () => {
    invokeMock.mockResolvedValue([0, 1, 2, 3, 4]);
    render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS + 1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("plot-mark-line")).toBeInTheDocument();
    });
  });

  it("throttles rapid crosshair changes to ≤30 Hz", async () => {
    invokeMock.mockResolvedValue([1, 2, 3]);

    let voxelCounter = 0;
    voxelTransformMock.mockImplementation(() => {
      voxelCounter += 1;
      return [voxelCounter, voxelCounter, voxelCounter] as [
        number,
        number,
        number,
      ];
    });

    const { rerender } = render(
      <CrosshairTimeSeriesPlotBody ctx={ctxFor({ crosshairMm: [1, 1, 1] })} />,
    );

    // Rapid rerenders inside the throttle window — only the first dispatch + one
    // trailing-edge dispatch should fire.
    for (let i = 2; i <= 6; i += 1) {
      rerender(
        <CrosshairTimeSeriesPlotBody
          ctx={ctxFor({ crosshairMm: [i, i, i] })}
        />,
      );
    }

    // Drain the leading + trailing throttle slots.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS * 3);
    });

    // 5 rapid changes within the throttle window must not produce 5 invocations.
    expect(invokeMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("skips invocation when voxel resolution fails (e.g. 3D layer)", async () => {
    setupThreeDLayer();
    invokeMock.mockResolvedValue([1]);
    render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS * 2);
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clears stale data when the crosshair leaves the volume", async () => {
    invokeMock.mockResolvedValue([1, 2, 3, 4]);
    const { rerender } = render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS + 1);
    });
    await waitFor(() =>
      expect(screen.getByTestId("plot-mark-line")).toBeInTheDocument(),
    );

    voxelTransformMock.mockReturnValue([100, 100, 100] as [
      number,
      number,
      number,
    ]);
    rerender(
      <CrosshairTimeSeriesPlotBody
        ctx={ctxFor({ crosshairMm: [50, 50, 50] })}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("plot-mark-line")).toBeNull();
    });
  });

  it("does not resurrect stale data when an in-flight request resolves after the target goes invalid", async () => {
    // Hold the first request open so it is still in flight when the crosshair
    // leaves the volume.
    let resolveInvoke: (value: number[]) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise<number[]>((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    const { rerender } = render(<CrosshairTimeSeriesPlotBody ctx={ctxFor()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMESERIES_THROTTLE_MS + 1);
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Crosshair leaves the volume before the request resolves.
    voxelTransformMock.mockReturnValue([100, 100, 100] as [
      number,
      number,
      number,
    ]);
    rerender(
      <CrosshairTimeSeriesPlotBody
        ctx={ctxFor({ crosshairMm: [50, 50, 50] })}
      />,
    );

    // The now-orphaned request resolves — it must be ignored, not rendered.
    await act(async () => {
      resolveInvoke([1, 2, 3, 4]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId("plot-mark-line")).toBeNull();
  });
});
