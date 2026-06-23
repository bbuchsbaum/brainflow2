/**
 * CenterWithBottomDock — wrapper behavior.
 *
 * The wrapper (1) always renders the routed view (its children); (2) mounts the
 * dock + resizer when `layoutSettingsStore.bottomDockOpen` is true (the
 * default); (3) routes PlotPanel / ActivityPanel / LogPanel into the dock slots
 * and resolves the Plot tab's default mode from the active layer; (4) closes
 * the dock via the dock's onClose.
 *
 * BottomWorkbenchDock is stubbed to expose its slot props; the panels are
 * stubbed so this stays a layout/wiring test.
 */

import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/components/layout/BottomWorkbenchDock", () => ({
  BottomWorkbenchDock: ({
    plot,
    activity,
    log,
    onClose,
  }: {
    plot: React.ReactNode;
    activity: React.ReactNode;
    log: React.ReactNode;
    onClose?: () => void;
  }) => (
    <div data-testid="bottom-dock-stub">
      <div data-testid="dock-slot-plot">{plot}</div>
      <div data-testid="dock-slot-activity">{activity}</div>
      <div data-testid="dock-slot-log">{log}</div>
      <button type="button" data-testid="dock-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("@/components/panels/PlotPanel", () => ({
  PlotPanel: (props: { defaultMode?: string }) => (
    <div
      data-testid="plot-panel-stub"
      data-default-mode={props.defaultMode ?? ""}
    >
      plot
    </div>
  ),
}));

vi.mock("@/components/panels/ActivityPanel", () => ({
  ActivityPanel: () => <div data-testid="activity-panel-stub">activity</div>,
}));

vi.mock("@/components/panels/LogPanel", () => ({
  LogPanel: () => <div data-testid="log-panel-stub">log</div>,
}));

import { CenterWithBottomDock } from "../CenterWithBottomDock";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";
import { useLayerStore } from "@/stores/layerStore";

function seedLayer(layer: Record<string, unknown> | null) {
  act(() => {
    useLayerStore.setState({
      layers: layer ? [layer as never] : [],
      selectedLayerId: layer ? (layer as { id: string }).id : null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

describe("CenterWithBottomDock", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
    seedLayer(null);
  });

  it("renders the routed view and shows the dock + resizer by default", () => {
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    expect(screen.getByTestId("routed-view")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-dock-stub")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-dock-resizer")).toBeInTheDocument();
  });

  it("hides the dock + resizer when bottomDockOpen is false", () => {
    useLayoutSettingsStore.getState().setBottomDockOpen(false);
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    expect(screen.getByTestId("routed-view")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-dock-stub")).toBeNull();
    expect(screen.queryByTestId("bottom-dock-resizer")).toBeNull();
  });

  it("routes PlotPanel, ActivityPanel, and LogPanel into the dock slots", () => {
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    expect(screen.getByTestId("dock-slot-plot")).toContainElement(
      screen.getByTestId("plot-panel-stub"),
    );
    expect(screen.getByTestId("dock-slot-activity")).toContainElement(
      screen.getByTestId("activity-panel-stub"),
    );
    expect(screen.getByTestId("dock-slot-log")).toContainElement(
      screen.getByTestId("log-panel-stub"),
    );
  });

  it("closes the dock when the dock requests it (onClose)", () => {
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    fireEvent.click(screen.getByTestId("dock-close"));
    expect(useLayoutSettingsStore.getState().bottomDockOpen).toBe(false);
    expect(screen.queryByTestId("bottom-dock-stub")).toBeNull();
  });

  it("resolves the Plot default mode to histogram for a 3D layer", () => {
    seedLayer({ id: "vol-1", name: "T1w", type: "volume" });
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    expect(
      screen.getByTestId("plot-panel-stub").getAttribute("data-default-mode"),
    ).toBe("histogram");
  });

  it("resolves the Plot default mode to crosshair-time-series for a 4D layer", () => {
    seedLayer({
      id: "vol-1",
      name: "BOLD run-01",
      type: "volume",
      timeSeriesInfo: { num_timepoints: 200 },
    });
    render(
      <CenterWithBottomDock>
        <div data-testid="routed-view">view</div>
      </CenterWithBottomDock>,
    );
    expect(
      screen.getByTestId("plot-panel-stub").getAttribute("data-default-mode"),
    ).toBe("crosshair-time-series");
  });
});
