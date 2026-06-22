import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewExportService } from "@/services/ViewExportService";
import { useActivePanelStore } from "@/stores/activePanelStore";
import { useActiveRenderContextStore } from "@/stores/activeRenderContextStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { Workspace, WorkspaceType } from "@/types/workspace";

function makeWorkspace(id: string, type: WorkspaceType): Workspace {
  return {
    id,
    type,
    title: id,
    presetId: null,
    timestamp: 1,
    isActive: true,
    layoutConfig: {} as never,
    panelStates: new Map(),
  };
}

vi.mock("@/services/transport", () => ({
  getTransport: () => ({
    invoke: vi.fn(),
  }),
}));

vi.mock("@/events/EventBus", () => ({
  getEventBus: () => ({
    emit: vi.fn(),
  }),
}));

describe("ViewExportService", () => {
  let service: ViewExportService;

  beforeEach(() => {
    service = new ViewExportService();
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    useWorkspaceStore.setState({
      workspaces: new Map(),
      activeWorkspaceId: null,
    });
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      viewpoint: "lateral",
      showControls: false,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
  });

  it("uses the active surface renderable exporter key directly", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    service.registerExporter("surfaceview:surface-a:view-1", async () => bytes);
    useActiveRenderContextStore.setState({
      activeId: "surfaceview:surface-a:view-1",
    });

    const result = await service.captureActiveView({ format: "png" });

    expect(result.bytes).toEqual(bytes);
    expect(result.componentType).toBe("surfaceview");
    expect(result.suggestedName).toMatch(/^surface-surface-a-.*\.png$/);
  });

  it("falls back to the active surface panel state and resolves the surface handle from store bindings", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    service.registerExporter("surfaceview:surface-b:view-2", async () => bytes);
    useActivePanelStore.setState({
      componentType: "SurfaceView",
      componentState: {
        surfaceViewId: "view-2",
      },
    });
    useSurfaceStore.setState({
      surfaceViewHandles: new Map([["view-2", "surface-b"]]),
    });

    const result = await service.captureActiveView({ format: "jpg" });

    expect(result.bytes).toEqual(bytes);
    expect(result.componentType).toBe("SurfaceView");
    expect(result.suggestedName).toMatch(/^surface-surface-b-.*\.jpg$/);
  });

  it("selects the exporter and filename from the live workspace type, not stale componentState", async () => {
    // GoldenLayout seeded this tab as orthogonal; the mode pill later switched it
    // to mosaic in place, so componentState.workspaceType is stale.
    const bytes = new Uint8Array([10, 11]);
    service.registerExporter("mosaic:w1", async () => bytes);
    useWorkspaceStore.setState({
      workspaces: new Map([["w1", makeWorkspace("w1", "mosaic")]]),
      activeWorkspaceId: "w1",
    });
    useActivePanelStore.setState({
      componentType: "Workspace",
      componentState: { workspaceId: "w1", workspaceType: "orthogonal-locked" },
    });

    const result = await service.captureActiveView({ format: "png" });

    expect(result.bytes).toEqual(bytes);
    expect(result.suggestedName).toMatch(/^mosaic-w1-.*\.png$/);
  });

  it("prefers the registered surface binding over a stale panel surface handle", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    service.registerExporter("surfaceview:surface-b:view-2", async () => bytes);
    useActivePanelStore.setState({
      componentType: "SurfaceView",
      componentState: {
        surfaceViewId: "view-2",
        surfaceHandle: "surface-stale",
      },
    });
    useSurfaceStore.setState({
      surfaceViewHandles: new Map([["view-2", "surface-b"]]),
    });

    const result = await service.captureActiveView({ format: "png" });

    expect(result.bytes).toEqual(bytes);
    expect(result.suggestedName).toMatch(/^surface-surface-b-.*\.png$/);
  });
});
