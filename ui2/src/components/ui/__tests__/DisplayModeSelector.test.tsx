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

    const tabs = screen.getAllByRole("radio");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Orthogonal",
      "Mosaic",
      "Compare",
    ]);
  });

  it("reveals the Integrated mode when the integratedWorkspaceV1 flag is on", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    const tabs = screen.getAllByRole("radio");
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
        screen.getByRole("radio", { name: new RegExp(`^${id}$`, "i") }).getAttribute("aria-checked"),
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
      screen.getByRole("radio", { name: "Orthogonal" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Mosaic" }).getAttribute("aria-checked"),
    ).toBe("false");
    // Per-segment hooks: display-mode-<id> + data-active.
    const orthogonal = screen.getByTestId("display-mode-orthogonal");
    expect(orthogonal).toBe(screen.getByRole("radio", { name: "Orthogonal" }));
    expect(orthogonal).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("display-mode-mosaic")).toHaveAttribute("data-active", "false");
  });

  it("marks the orthogonal pill active for orthogonal-flexible workspaces too (both types belong to one mode)", () => {
    workspaceStoreState.workspaces.set(
      "w-1",
      makeWorkspace("w-1", "orthogonal-flexible"),
    );
    workspaceStoreState.activeWorkspaceId = "w-1";

    render(<DisplayModeSelector />);

    expect(
      screen.getByRole("radio", { name: "Orthogonal" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it.each(["set-studio", "bids-explorer", "analysis-workbench"] as const)(
    "stays visible with no active segment when the active workspace is a tool (%s)",
    (toolType) => {
      workspaceStoreState.workspaces.set("w-1", makeWorkspace("w-1", toolType));
      workspaceStoreState.activeWorkspaceId = "w-1";

      render(<DisplayModeSelector />);

      const selector = screen.getByTestId("display-mode-selector");
      expect(selector.getAttribute("data-active-mode")).toBe("");
      expect(
        screen
          .getAllByRole("radio")
          .every((tab) => tab.getAttribute("aria-checked") === "false"),
      ).toBe(true);
    },
  );

  it("returns from a tool to the latest view in the clicked mode without reconfiguring the tool tab", () => {
    const older = makeWorkspace("view-old", "mosaic");
    older.timestamp = 1;
    const newer = makeWorkspace("view-new", "mosaic");
    newer.timestamp = 2;
    workspaceStoreState.workspaces.set("view-old", older);
    workspaceStoreState.workspaces.set("view-new", newer);
    workspaceStoreState.workspaces.set(
      "tool",
      makeWorkspace("tool", "bids-explorer"),
    );
    workspaceStoreState.activeWorkspaceId = "tool";

    render(<DisplayModeSelector />);
    fireEvent.click(screen.getByRole("radio", { name: "Mosaic" }));

    expect(workspaceStoreState.activateWorkspace).toHaveBeenCalledWith(
      "view-new",
    );
    expect(workspaceStoreState.setActiveWorkspaceMode).not.toHaveBeenCalled();
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it("opens a new view from a tool when no view is in the clicked mode", () => {
    workspaceStoreState.workspaces.set(
      "tool",
      makeWorkspace("tool", "analysis-workbench"),
    );
    workspaceStoreState.activeWorkspaceId = "tool";

    render(<DisplayModeSelector />);
    fireEvent.click(screen.getByRole("radio", { name: "Orthogonal" }));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith(
      "orthogonal-locked",
    );
    expect(workspaceStoreState.setActiveWorkspaceMode).not.toHaveBeenCalled();
  });

  it("does not render the surface pill (no workspace mapping yet)", () => {
    render(<DisplayModeSelector />);

    expect(screen.queryByRole("radio", { name: "Surface" })).toBeNull();
  });

  it("does not render the integrated pill when the integratedWorkspaceV1 flag is off", () => {
    featureFlagStoreState.integratedWorkspaceV1 = false;

    render(<DisplayModeSelector />);

    expect(screen.queryByRole("radio", { name: "Integrated" })).toBeNull();
  });

  it("renders an enabled integrated pill when the integratedWorkspaceV1 flag is on", () => {
    featureFlagStoreState.integratedWorkspaceV1 = true;

    render(<DisplayModeSelector />);

    const integratedPill = screen.getByRole("radio", { name: "Integrated" });
    expect(integratedPill).not.toBeDisabled();
    expect(integratedPill.getAttribute("aria-checked")).toBe("false");
  });

  it("creates the first workspace when a pill is clicked with no active workspace (cold start)", () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByRole("radio", { name: "Mosaic" }));

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

    fireEvent.click(screen.getByRole("radio", { name: "Mosaic" }));

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

    fireEvent.click(screen.getByRole("radio", { name: "Integrated" }));

    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.createWorkspace).toHaveBeenCalledWith(
      "integrated",
    );
  });

  it("targets the orthogonal-locked workspace type when the orthogonal pill is clicked from no-active-workspace", () => {
    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByRole("radio", { name: "Orthogonal" }));

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

    fireEvent.click(screen.getByRole("radio", { name: "Orthogonal" }));

    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledTimes(1);
    expect(workspaceStoreState.setActiveWorkspaceMode).toHaveBeenCalledWith(
      "orthogonal",
    );
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it("treats a click on the already-active segment as a no-op (radio semantics; the store would no-op anyway)", () => {
    // bf SegmentedControl does not re-fire onValueChange for the checked
    // segment. Before the migration the click reached setActiveWorkspaceMode,
    // which no-ops for the same mode inside the store.
    workspaceStoreState.workspaces.set(
      "view-1",
      makeWorkspace("view-1", "orthogonal-locked"),
    );
    workspaceStoreState.activeWorkspaceId = "view-1";

    render(<DisplayModeSelector />);

    fireEvent.click(screen.getByRole("radio", { name: "Orthogonal" }));

    expect(workspaceStoreState.setActiveWorkspaceMode).not.toHaveBeenCalled();
    expect(workspaceStoreState.createWorkspace).not.toHaveBeenCalled();
  });

  it("is one tab stop (radio group); in a tool workspace the stop is the first segment", () => {
    workspaceStoreState.workspaces.set("tool", makeWorkspace("tool", "bids-explorer"));
    workspaceStoreState.activeWorkspaceId = "tool";

    render(<DisplayModeSelector />);

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(screen.getByRole("radiogroup", { name: "Display mode" })).toBeInTheDocument();
  });
});
