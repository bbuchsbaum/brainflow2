/**
 * CenterWithPlotDock — wrapper behavior.
 *
 * The wrapper must (1) always render the routed view (its children), and
 * (2) mount the dock + resizer only when `layoutSettingsStore.plotDockOpen`
 * is true. When closed, the view pane is the sole flex child (pre-dock layout).
 *
 * PlotDock is stubbed so this stays a layout test rather than dragging in the
 * full plot stack (PlotPanel → viewStateStore, etc.). No Allotment is used, so
 * no ResizeObserver polyfill is needed.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/PlotDock", () => ({
  PlotDock: () => <div data-testid="plot-dock-stub" />,
}));

import { CenterWithPlotDock } from "../CenterWithPlotDock";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

describe("CenterWithPlotDock", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it("renders the routed view and keeps the dock closed by default", () => {
    render(
      <CenterWithPlotDock>
        <div data-testid="routed-view">view</div>
      </CenterWithPlotDock>,
    );
    expect(screen.getByTestId("routed-view")).toBeInTheDocument();
    expect(screen.queryByTestId("plot-dock-stub")).toBeNull();
    expect(screen.queryByTestId("plot-dock-resizer")).toBeNull();
  });

  it("mounts the dock and the resizer when plotDockOpen is true", () => {
    useLayoutSettingsStore.getState().setPlotDockOpen(true);
    render(
      <CenterWithPlotDock>
        <div data-testid="routed-view">view</div>
      </CenterWithPlotDock>,
    );
    expect(screen.getByTestId("routed-view")).toBeInTheDocument();
    expect(screen.getByTestId("plot-dock-stub")).toBeInTheDocument();
    expect(screen.getByTestId("plot-dock-resizer")).toBeInTheDocument();
  });
});
