import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Workspace, WorkspaceType } from "@/types/workspace";

const workspaceStoreState = vi.hoisted(() => ({
  workspaces: new Map<string, Workspace>(),
  activeWorkspaceId: null as string | null,
  createWorkspace: vi.fn(async (type: WorkspaceType) => `${type}-mock-1`),
  activateWorkspace: vi.fn((id: string) => {
    workspaceStoreState.activeWorkspaceId = id;
  }),
  setActiveWorkspaceMode: vi.fn(),
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

import { DisplayModeSelector } from "../DisplayModeSelector";

function makeWorkspace(id: string, type: WorkspaceType): Workspace {
  return {
    id,
    type,
    title: id,
    presetId: null,
    timestamp: Date.now(),
    isActive: false,
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

function resetState() {
  workspaceStoreState.workspaces = new Map();
  workspaceStoreState.activeWorkspaceId = null;
  workspaceStoreState.createWorkspace.mockClear();
  workspaceStoreState.activateWorkspace.mockClear();
  workspaceStoreState.setActiveWorkspaceMode.mockClear();
  featureFlagStoreState.integratedWorkspaceV1 = false;
}

describe("DisplayModeSelector", () => {
  beforeEach(() => {
    resetState();
  });

  it("renders only the available modes (Surface/Integrated hidden) in order when the integrated flag is off", () => {
    render(<DisplayModeSelector />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Orthogonal",
      "Mosaic",
      "Compare",
    ]);
  });

  it("reveals the Integrated mode when the integratedWorkspaceV1 flag is on", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Orthogonal",
      "Integrated",
      "Mosaic",
      "Compare",
    ]);
  });

  it("marks no pill active when there is no active workspace", () => {
    render(<DisplayModeSelector />);

    const selector = screen.getByTestId("display-mode-selector");
    expect(selector.getAttribute("data-active-mode")).toBe("");
    for (const id of ["orthogonal", "mosaic", "compare"]) {
      expect(
        screen.getByTestId(`display-mode-${id}`).getAttribute("data-active"),
      ).toBe("false");
    }
  });

  it("marks the orthogonal pill active when the active workspace is orthogonal-locked", () => {
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "orthogonal-locked"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(
      screen
        .getByTestId("display-mode-selector")
        .getAttribute("data-active-mode"),
    ).toBe("orthogonal");
    expect(
      screen.getByTestId("display-mode-orthogonal").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("display-mode-mosaic").getAttribute("data-active"),
    ).toBe("false");
  });

  it("marks the orthogonal pill active for orthogonal-flexible workspaces too (both types belong to one mode)", () => {
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "orthogonal-flexible"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(
      screen.getByTestId("display-mode-orthogonal").getAttribute("data-active"),
    ).toBe("true");
  });

  it("hides the pill entirely when the active workspace is a tool (set-studio)", () => {
    // The pill governs view modes only; with a tool destination active there is
    // no mode to switch, so the whole selector is hidden rather than shown empty.
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "set-studio"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(screen.queryByTestId("display-mode-selector")).toBeNull();
  });

  it("hides the pill when the active workspace is BIDS Explorer", () => {
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "bids-explorer"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(screen.queryByTestId("display-mode-selector")).toBeNull();
  });

  it("hides the pill when the active workspace is the Analysis Workbench", () => {
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "analysis-workbench"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(screen.queryByTestId("display-mode-selector")).toBeNull();
  });

  it("does not render the surface pill (no workspace mapping yet)", () => {
    render(<DisplayModeSelector />);

    expect(screen.queryByTestId("display-mode-surface")).toBeNull();
  });

  it("does not render the integrated pill when the integratedWorkspaceV1 flag is off", () => {
    featureFlagStoreState.integratedWorkspaceV1 = false;

    render(<DisplayModeSelector />);

    expect(screen.queryByTestId("display-mode-integrated")).toBeNull();
  });

  it("renders an enabled integrated pill when the integratedWorkspaceV1 flag is on", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    const integratedPill = screen.getByTestId("display-mode-integrated");
    expect(integratedPill).not.toBeDisabled();
    expect(integratedPill.getAttribute("data-active")).toBe("false");
  });

  it("creates the first workspace when a pill is clicked with no active workspace (cold start)", () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-mosaic"));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith("mosaic");
    expect(workspaceStoreState.setActiveWorkspaceMode).not.toHaveBeenCalled();
  });

  it("reconfigures the active tab's mode in place (does not create or activate another tab) when a different-mode pill is clicked", () => {
    // Pills now set the MODE of the active view tab; tabs stay the substrate.
    workspaceStoreState.workspaces.set(
      "view-1",
      makeWorkspace("view-1", "orthogonal-locked"),
    );
    workspaceStoreState.activeWorkspaceId = "view-1";

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-mosaic"));

    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledWith(
      "mosaic",
    );
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
    expect(workspaceStoreState.activateWorkspace).not.toHaveBeenCalled();
  });

  it("creates an integrated workspace when the flag is on and clicked", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-integrated"));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith(
      "integrated",
    );
  });

  it("targets the orthogonal-locked workspace type when the orthogonal pill is clicked from no-active-workspace", () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-orthogonal"));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith(
      "orthogonal-locked",
    );
  });

  it("sets the active tab's mode to orthogonal in place when Orthogonal is clicked from a mosaic view (no new tab)", () => {
    // The app boots with a single view tab. Clicking Orthogonal from a mosaic
    // view reconfigures THAT tab in place rather than spawning/activating a
    // separate orthogonal workspace. (The store's no-op-if-already-orthogonal
    // guard — which keeps an orthogonal-flexible tab flexible — is covered in
    // the workspaceStore tests.)
    workspaceStoreState.workspaces.set(
      "view-1",
      makeWorkspace("view-1", "mosaic"),
    );
    workspaceStoreState.activeWorkspaceId = "view-1";

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-orthogonal"));

    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledWith(
      "orthogonal",
    );
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it("routes a click on the already-active mode through setActiveWorkspaceMode (store no-ops internally)", () => {
    workspaceStoreState.workspaces.set(
      "view-1",
      makeWorkspace("view-1", "orthogonal-locked"),
    );
    workspaceStoreState.activeWorkspaceId = "view-1";

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByTestId("display-mode-orthogonal"));

    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledWith(
      "orthogonal",
    );
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });
});
