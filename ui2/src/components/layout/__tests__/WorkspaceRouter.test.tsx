import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Workspace, WorkspaceType } from "@/types/workspace";

const workspaceStoreState = vi.hoisted(() => ({
  workspaces: new Map<string, Workspace>(),
  activeWorkspaceId: null as string | null,
}));

const featureFlagStoreState = vi.hoisted(() => ({
  multiViewBatch: false,
  setMultiViewBatchEnabled: vi.fn(),
  toggleMultiViewBatch: vi.fn(),
  integratedWorkspaceV1: false,
  setIntegratedWorkspaceV1Enabled: vi.fn(),
  toggleIntegratedWorkspaceV1: vi.fn(),
}));

vi.mock("@/stores/workspaceStore", () => {
  type Selector<T> = (state: typeof workspaceStoreState) => T;
  const useWorkspaceStore = (<T,>(selector: Selector<T>) =>
    selector(workspaceStoreState)) as {
    <T>(selector: Selector<T>): T;
    getState: () => typeof workspaceStoreState;
  };
  useWorkspaceStore.getState = () => workspaceStoreState;
  return { useWorkspaceStore };
});

vi.mock("@/stores/featureFlagStore", () => {
  type Selector<T> = (state: typeof featureFlagStoreState) => T;
  const useFeatureFlagStore = (<T,>(selector: Selector<T>) =>
    selector(featureFlagStoreState)) as {
    <T>(selector: Selector<T>): T;
    getState: () => typeof featureFlagStoreState;
  };
  useFeatureFlagStore.getState = () => featureFlagStoreState;
  return { useFeatureFlagStore };
});

// Stub each routed workspace component so the router test stays isolated.
vi.mock("@/components/views/OrthogonalViewContainer", () => ({
  OrthogonalViewContainer: () => (
    <div data-testid="route-orthogonal-locked">orthogonal-locked</div>
  ),
}));
vi.mock("@/components/views/OrthogonalPanelsWorkspace", () => ({
  OrthogonalPanelsWorkspace: () => (
    <div data-testid="route-orthogonal-flexible">orthogonal-flexible</div>
  ),
}));
vi.mock("@/components/views/MosaicViewPromise", () => ({
  MosaicViewPromise: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="route-mosaic" data-workspace-id={workspaceId}>
      mosaic
    </div>
  ),
}));
vi.mock("@/components/views/ComparisonWorkspace", () => ({
  ComparisonWorkspace: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="route-comparison" data-workspace-id={workspaceId}>
      comparison
    </div>
  ),
}));
vi.mock("@/components/studio/SetStudioWorkspace", () => ({
  SetStudioWorkspace: () => (
    <div data-testid="route-set-studio">set-studio</div>
  ),
}));
vi.mock("@/components/bids/BidsExplorerWorkspace", () => ({
  BidsExplorerWorkspace: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="route-bids-explorer" data-workspace-id={workspaceId}>
      bids
    </div>
  ),
}));
vi.mock("@/components/analysis/AnalysisWorkbenchWorkspace", () => ({
  AnalysisWorkbenchWorkspace: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="route-analysis-workbench" data-workspace-id={workspaceId}>
      analysis
    </div>
  ),
}));
vi.mock("@/components/views/IntegratedVolumeSurfaceWorkspace", () => ({
  IntegratedVolumeSurfaceWorkspace: () => (
    <div data-testid="route-integrated">integrated</div>
  ),
}));
// Transparent stub: the plot-dock wrapper just renders the routed view here,
// keeping this test focused on routing (the dock has its own tests).
vi.mock("@/components/layout/CenterWithPlotDock", () => ({
  CenterWithPlotDock: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="center-with-plot-dock">{children}</div>
  ),
}));

import { WorkspaceRouter } from "../WorkspaceRouter";

function makeWorkspace(id: string, type: WorkspaceType): Workspace {
  return {
    id,
    type,
    title: id,
    presetId: null,
    timestamp: Date.now(),
    isActive: true,
    layoutConfig: {
      root: {
        type: "component",
        componentType: "EmptyView",
        title: id,
        componentState: {},
      },
    },
    panelStates: new Map(),
  };
}

function seedWorkspace(id: string, type: WorkspaceType) {
  workspaceStoreState.workspaces = new Map([[id, makeWorkspace(id, type)]]);
  workspaceStoreState.activeWorkspaceId = id;
}

beforeEach(() => {
  workspaceStoreState.workspaces = new Map();
  workspaceStoreState.activeWorkspaceId = null;
  featureFlagStoreState.integratedWorkspaceV1 = false;
});

describe("WorkspaceRouter", () => {
  it('renders a "not found" notice when the workspace id is not in the store', () => {
    render(<WorkspaceRouter workspaceId="missing" workspaceType="mosaic" />);

    expect(
      screen.getByTestId("workspace-router-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("route-mosaic")).toBeNull();
  });

  it("routes orthogonal-locked → OrthogonalViewContainer", () => {
    seedWorkspace("w-1", "orthogonal-locked");
    render(
      <WorkspaceRouter workspaceId="w-1" workspaceType="orthogonal-locked" />,
    );
    expect(screen.getByTestId("route-orthogonal-locked")).toBeInTheDocument();
  });

  it("routes orthogonal-flexible → OrthogonalPanelsWorkspace", () => {
    seedWorkspace("w-2", "orthogonal-flexible");
    render(
      <WorkspaceRouter workspaceId="w-2" workspaceType="orthogonal-flexible" />,
    );
    expect(screen.getByTestId("route-orthogonal-flexible")).toBeInTheDocument();
  });

  it("routes mosaic / comparison / set-studio / bids-explorer / analysis-workbench correctly", () => {
    const cases: Array<{ type: WorkspaceType; testid: string }> = [
      { type: "mosaic", testid: "route-mosaic" },
      { type: "comparison", testid: "route-comparison" },
      { type: "set-studio", testid: "route-set-studio" },
      { type: "bids-explorer", testid: "route-bids-explorer" },
      { type: "analysis-workbench", testid: "route-analysis-workbench" },
    ];

    for (const { type, testid } of cases) {
      seedWorkspace(`w-${type}`, type);
      const { unmount } = render(
        <WorkspaceRouter workspaceId={`w-${type}`} workspaceType={type} />,
      );
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      unmount();
    }
  });

  it("routes by the LIVE store type, not the initial prop (in-place mode swap)", () => {
    // The pills mutate workspace.type in the store; the tab keeps its original
    // componentState prop. The router must follow the store so the tab body
    // re-renders into the new mode without recreating the tab.
    seedWorkspace("w-swap", "mosaic");
    render(
      <WorkspaceRouter
        workspaceId="w-swap"
        workspaceType="orthogonal-locked"
      />,
    );
    expect(screen.getByTestId("route-mosaic")).toBeInTheDocument();
    expect(screen.queryByTestId("route-orthogonal-locked")).toBeNull();
  });

  it("shows the disabled-flag notice for integrated when integratedWorkspaceV1 is off", () => {
    featureFlagStoreState.integratedWorkspaceV1 = false;
    seedWorkspace("w-i", "integrated");

    render(<WorkspaceRouter workspaceId="w-i" workspaceType="integrated" />);

    expect(
      screen.getByTestId("integrated-workspace-flag-disabled"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("route-integrated")).toBeNull();
  });

  it("mounts the integrated shell when integratedWorkspaceV1 is on", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;
    seedWorkspace("w-i", "integrated");

    render(<WorkspaceRouter workspaceId="w-i" workspaceType="integrated" />);

    expect(screen.getByTestId("route-integrated")).toBeInTheDocument();
    expect(
      screen.queryByTestId("integrated-workspace-flag-disabled"),
    ).toBeNull();
  });

  // All imaging workspaces are wrapped in the shared bottom PlotDock
  // (CenterWithPlotDock), which gives the view pane a definite-height box via
  // absolute insets so each view's sizing (orthogonal / mosaic / comparison)
  // reflows cleanly when the dock resizes. See docs/plans/plot-integration-plan.md.
  it("wraps the imaging views in the plot dock", () => {
    const cases: Array<{ type: WorkspaceType; testid: string }> = [
      { type: "orthogonal-locked", testid: "route-orthogonal-locked" },
      { type: "orthogonal-flexible", testid: "route-orthogonal-flexible" },
      { type: "mosaic", testid: "route-mosaic" },
      { type: "comparison", testid: "route-comparison" },
    ];

    for (const { type, testid } of cases) {
      seedWorkspace(`w-wrap-${type}`, type);
      const { unmount } = render(
        <WorkspaceRouter workspaceId={`w-wrap-${type}`} workspaceType={type} />,
      );
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      expect(screen.getByTestId("center-with-plot-dock")).toBeInTheDocument();
      unmount();
    }
  });

  it("does NOT wrap non-imaging workspaces in the plot dock", () => {
    const cases: Array<{ type: WorkspaceType; testid: string }> = [
      { type: "set-studio", testid: "route-set-studio" },
      { type: "bids-explorer", testid: "route-bids-explorer" },
      { type: "analysis-workbench", testid: "route-analysis-workbench" },
    ];
    for (const { type, testid } of cases) {
      seedWorkspace(`w-bare-${type}`, type);
      const { unmount } = render(
        <WorkspaceRouter workspaceId={`w-bare-${type}`} workspaceType={type} />,
      );
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      expect(screen.queryByTestId("center-with-plot-dock")).toBeNull();
      unmount();
    }
  });
});
