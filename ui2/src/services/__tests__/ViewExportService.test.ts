import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewExportService, sliceExportFileName, withImageExtension } from "@/services/ViewExportService";
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

const { invokeMock, emitMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock("@/services/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/transport")>()),
  getTransport: () => ({
    invoke: invokeMock,
  }),
}));

vi.mock("@/events/EventBus", () => ({
  getEventBus: () => ({
    emit: emitMock,
    on: vi.fn(() => () => {}),
  }),
}));

describe("ViewExportService", () => {
  let service: ViewExportService;

  beforeEach(() => {
    invokeMock.mockReset();
    emitMock.mockReset();
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

  it("renders export panes to bytes for the export alone: no render.complete, nothing shared on screen", async () => {
    // compositeCapture decodes these bytes into its own ImageBitmaps and
    // closes them after compose (ui2/CLAUDE.md MosaicView rule 3 is about
    // bitmaps handed to on-screen canvases; these never are).
    const { useViewStateStore } = await import("@/stores/viewStateStore");
    invokeMock.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const base = useViewStateStore.getState().viewState;
    const viewState = {
      ...base,
      layers: [
        { id: "t1", name: "t1", volumeId: "v1", visible: true, opacity: 1, colormap: "gray", intensity: [0, 100], threshold: [0, 0] },
      ],
    } as never;
    const bytes = await service.renderViewToBytes(
      viewState,
      "axial",
      64,
      64,
      "png",
      false,
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(invokeMock).toHaveBeenCalledWith("render_view", expect.objectContaining({ format: "png" }));
    expect(emitMock).not.toHaveBeenCalled();
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
  it("saves through save_image_bytes and reports the written path", async () => {
    invokeMock.mockResolvedValue("/tmp/out/slice.png");

    const path = await service.saveImageBytes(
      new Uint8Array([137, 80]),
      "slice.png",
    );

    expect(path).toBe("/tmp/out/slice.png");
    // Raw body (the Uint8Array itself) plus a percent-encoded header.
    expect(invokeMock).toHaveBeenCalledWith(
      "save_image_bytes",
      new Uint8Array([137, 80]),
      { headers: { "x-brainflow-suggested-name": "slice.png" } },
    );
    expect(emitMock).toHaveBeenCalledWith("ui.notification", {
      type: "info",
      message: "Saved image to /tmp/out/slice.png",
    });
  });

  it("percent-encodes non-ASCII suggested names", async () => {
    invokeMock.mockResolvedValue("/tmp/out/x.png");

    await service.saveImageBytes(new Uint8Array([137]), "Résultats fig 1.png");

    expect(invokeMock).toHaveBeenCalledWith("save_image_bytes", new Uint8Array([137]), {
      headers: { "x-brainflow-suggested-name": "R%C3%A9sultats%20fig%201.png" },
    });
  });

  it("treats a cancelled save dialog (null) as no-op, not an error", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(
      service.saveImageBytes(new Uint8Array([1]), ""),
    ).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith(
      "save_image_bytes",
      new Uint8Array([1]),
      { headers: {} },
    );
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("exportActiveView stays silent when the user cancels the save dialog", async () => {
    service.registerExporter("surfaceview:s:v", async () => new Uint8Array([7]));
    useActiveRenderContextStore.setState({ activeId: "surfaceview:s:v" });
    invokeMock.mockResolvedValue(null);

    await service.exportActiveView({ format: "jpg" });

    expect(invokeMock).toHaveBeenCalledWith(
      "save_image_bytes",
      new Uint8Array([7]),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("export file names", () => {
  // The shared rule (utils/exportFileName): the axis letter before the
  // signed position, so a name never reads "_-".
  it("names a slice export by layer, plane and position", () => {
    expect(sliceExportFileName("zmap_synthetic.nii.gz", "axial", 50.5, "png")).toBe("zmap_synthetic_axial_z50.5mm.png");
    expect(sliceExportFileName("my map (v2).nii", "coronal", -19.5, "jpg")).toBe("my_map_v2_coronal_y-19.5mm.jpg");
    expect(sliceExportFileName(null, "sagittal", -0.04, "png")).toBe("view_sagittal_x0.0mm.png");
  });

  it("swaps only the extension of a typed name", () => {
    expect(withImageExtension("figure2a.png", "jpg")).toBe("figure2a.jpg");
    expect(withImageExtension("figure2a", "png")).toBe("figure2a.png");
  });
});

