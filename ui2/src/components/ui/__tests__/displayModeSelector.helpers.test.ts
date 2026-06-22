import { describe, expect, it } from "vitest";

import type { WorkspaceType } from "@/types/workspace";
import {
  WORKSPACE_TYPE_TO_DISPLAY_MODE,
  DISPLAY_MODE_PILL_ORDER,
  resolveActiveDisplayMode,
  getDisplayModePillMetadata,
  isViewWorkspaceType,
  workspaceTabLabel,
  workspaceTabLabels,
  planTabTitleUpdates,
} from "../displayModeSelector.helpers";

describe("resolveActiveDisplayMode", () => {
  it("returns null for null/undefined workspace types", () => {
    expect(resolveActiveDisplayMode(null)).toBeNull();
    expect(resolveActiveDisplayMode(undefined)).toBeNull();
  });

  it('maps both orthogonal-locked and orthogonal-flexible to "orthogonal"', () => {
    expect(resolveActiveDisplayMode("orthogonal-locked")).toBe("orthogonal");
    expect(resolveActiveDisplayMode("orthogonal-flexible")).toBe("orthogonal");
  });

  it("maps mosaic, comparison, and integrated to their corresponding display modes", () => {
    expect(resolveActiveDisplayMode("mosaic")).toBe("mosaic");
    expect(resolveActiveDisplayMode("comparison")).toBe("compare");
    expect(resolveActiveDisplayMode("integrated")).toBe("integrated");
  });

  it("returns null for workspace types intentionally not on the pill rail", () => {
    expect(resolveActiveDisplayMode("set-studio")).toBeNull();
    expect(resolveActiveDisplayMode("bids-explorer")).toBeNull();
    expect(resolveActiveDisplayMode("analysis-workbench")).toBeNull();
  });
});

describe("DISPLAY_MODE_PILL_ORDER", () => {
  it("renders Orthogonal, Surface, Integrated, Mosaic, Compare in that order", () => {
    expect(DISPLAY_MODE_PILL_ORDER).toEqual([
      "orthogonal",
      "surface",
      "integrated",
      "mosaic",
      "compare",
    ]);
  });
});

describe("getDisplayModePillMetadata", () => {
  it("returns five metadata entries with stable ids in pill order", () => {
    const meta = getDisplayModePillMetadata();
    expect(meta).toHaveLength(5);
    expect(meta.map((m) => m.id)).toEqual([...DISPLAY_MODE_PILL_ORDER]);
  });

  it("marks integrated mode as flag-gated by integratedWorkspaceV1", () => {
    const integrated = getDisplayModePillMetadata().find(
      (m) => m.id === "integrated",
    );
    expect(integrated?.featureFlag).toBe("integratedWorkspaceV1");
  });

  it("leaves surface mode without a default workspace type (renders disabled)", () => {
    const surface = getDisplayModePillMetadata().find(
      (m) => m.id === "surface",
    );
    expect(surface?.defaultWorkspaceType).toBeNull();
  });
});

describe("isViewWorkspaceType", () => {
  it("is true for pill-governed view types", () => {
    expect(isViewWorkspaceType("orthogonal-locked")).toBe(true);
    expect(isViewWorkspaceType("orthogonal-flexible")).toBe(true);
    expect(isViewWorkspaceType("mosaic")).toBe(true);
    expect(isViewWorkspaceType("comparison")).toBe(true);
    expect(isViewWorkspaceType("integrated")).toBe(true);
  });

  it("is false for tool destinations and for no workspace", () => {
    expect(isViewWorkspaceType("set-studio")).toBe(false);
    expect(isViewWorkspaceType("bids-explorer")).toBe(false);
    expect(isViewWorkspaceType("analysis-workbench")).toBe(false);
    expect(isViewWorkspaceType(null)).toBe(false);
    expect(isViewWorkspaceType(undefined)).toBe(false);
  });
});

describe("workspaceTabLabel", () => {
  it("labels view workspaces by their live display mode (so the tab matches the pill)", () => {
    expect(workspaceTabLabel({ type: "orthogonal-locked" })).toBe("Orthogonal");
    expect(workspaceTabLabel({ type: "orthogonal-flexible" })).toBe(
      "Orthogonal",
    );
    expect(workspaceTabLabel({ type: "mosaic" })).toBe("Mosaic");
    expect(workspaceTabLabel({ type: "comparison" })).toBe("Compare");
    expect(workspaceTabLabel({ type: "integrated" })).toBe("Integrated");
  });

  it("labels tool workspaces by their descriptive name", () => {
    expect(workspaceTabLabel({ type: "set-studio" })).toBe("Set Studio");
    expect(workspaceTabLabel({ type: "bids-explorer" })).toBe("BIDS Explorer");
    expect(workspaceTabLabel({ type: "analysis-workbench" })).toBe(
      "Analysis Workbench",
    );
  });
});

describe("workspaceTabLabels (disambiguation)", () => {
  const ws = (id: string, type: WorkspaceType, timestamp: number) => ({
    id,
    type,
    timestamp,
  });

  it("labels a lone view workspace by mode and a tool by its name", () => {
    const labels = workspaceTabLabels([
      ws("m1", "mosaic", 1),
      ws("b1", "bids-explorer", 2),
    ]);
    expect(labels.get("m1")).toBe("Mosaic");
    expect(labels.get("b1")).toBe("BIDS Explorer");
  });

  it("numbers multiple view tabs that resolve to the same mode, oldest first", () => {
    // orthogonal-locked + orthogonal-flexible both resolve to 'orthogonal'.
    const labels = workspaceTabLabels([
      ws("a", "orthogonal-locked", 10),
      ws("b", "orthogonal-flexible", 20),
    ]);
    expect(labels.get("a")).toBe("Orthogonal");
    expect(labels.get("b")).toBe("Orthogonal 2");
  });

  it("does not number across different modes", () => {
    const labels = workspaceTabLabels([
      ws("a", "orthogonal-locked", 1),
      ws("c", "comparison", 2),
    ]);
    expect(labels.get("a")).toBe("Orthogonal");
    expect(labels.get("c")).toBe("Compare");
  });
});

describe("planTabTitleUpdates", () => {
  const workspaces = [
    { id: "w1", type: "mosaic" as WorkspaceType, timestamp: 1 },
  ];

  it("returns an update for a tab whose title is stale", () => {
    expect(
      planTabTitleUpdates(
        [{ workspaceId: "w1", title: "Orthogonal" }],
        workspaces,
      ),
    ).toEqual([{ workspaceId: "w1", title: "Mosaic" }]);
  });

  it("returns nothing when the title already matches the live mode", () => {
    expect(
      planTabTitleUpdates([{ workspaceId: "w1", title: "Mosaic" }], workspaces),
    ).toEqual([]);
  });

  it("skips tabs with no id or an unknown workspace id", () => {
    expect(
      planTabTitleUpdates(
        [
          { workspaceId: null, title: "x" },
          { workspaceId: "ghost", title: "y" },
        ],
        workspaces,
      ),
    ).toEqual([]);
  });
});

describe("WORKSPACE_TYPE_TO_DISPLAY_MODE map", () => {
  it("does not include set-studio / bids-explorer / analysis-workbench (mode pills are visualization-only)", () => {
    expect(
      WORKSPACE_TYPE_TO_DISPLAY_MODE["set-studio" as never],
    ).toBeUndefined();
    expect(
      WORKSPACE_TYPE_TO_DISPLAY_MODE["bids-explorer" as never],
    ).toBeUndefined();
    expect(
      WORKSPACE_TYPE_TO_DISPLAY_MODE["analysis-workbench" as never],
    ).toBeUndefined();
  });
});
