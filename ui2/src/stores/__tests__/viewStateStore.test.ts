import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useViewStateStore } from "../viewStateStore";
import { useViewLayoutStore } from "../viewLayoutStore";
import { useWorkspaceStore } from "../workspaceStore";
import { coalesceUtils } from "../middleware/coalesceUpdatesMiddleware";
import type { ViewType, WorldCoordinates } from "@/types/coordinates";
import type { Layer } from "@/types/layer";

const recalcAllViewsMock = vi.fn();
const recalcViewForDimensionsMock = vi.fn();
const getVolumeBoundsMock = vi.fn();
const initRenderLoopMock = vi.fn();

vi.mock("@/services/apiService", () => ({
  getApiService: () => ({
    recalculateAllViews: recalcAllViewsMock,
    recalculateViewForDimensions: recalcViewForDimensionsMock,
    getVolumeBounds: getVolumeBoundsMock,
    initRenderLoop: initRenderLoopMock,
  }),
}));

describe("ViewStateStore", () => {
  let store: ReturnType<typeof useViewStateStore.getState>;
  let mockBackendCallback: ReturnType<typeof vi.fn>;
  const waitForFlush = async (delay = 25) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
  };

  beforeEach(() => {
    // Get the store state (which contains both state and methods)
    store = useViewStateStore.getState();

    // Reset store to initial state
    store.resetToDefaults();
    useWorkspaceStore.setState({
      workspaces: new Map(),
      activeWorkspaceId: null,
    });

    // Clear any pending coalescing updates
    coalesceUtils.clearPending();

    // Set up mock backend callback
    mockBackendCallback = vi.fn();
    coalesceUtils.setBackendCallback(mockBackendCallback);
    coalesceUtils.setEnabled(true);

    recalcAllViewsMock.mockReset();
    recalcViewForDimensionsMock.mockReset();
    getVolumeBoundsMock.mockReset();
    initRenderLoopMock.mockReset();

    recalcAllViewsMock.mockResolvedValue({
      axial: useViewStateStore.getState().viewState.views.axial,
      sagittal: useViewStateStore.getState().viewState.views.sagittal,
      coronal: useViewStateStore.getState().viewState.views.coronal,
    });

    recalcViewForDimensionsMock.mockResolvedValue(
      useViewStateStore.getState().viewState.views.axial,
    );

    getVolumeBoundsMock.mockResolvedValue({
      min: [-100, -100, -100],
      max: [100, 100, 100],
    });
  });

  afterEach(() => {
    coalesceUtils.clearPending();
    vi.clearAllTimers();
  });

  describe("navigation during async work", () => {
    it('publishes explicitly scoped updates without changing the active workspace', () => {
      const initial = useViewStateStore.getState();
      const other = structuredClone(initial.viewState);
      useViewStateStore.setState({
        activeWorkspaceKey: 'B', viewState: other,
        workspaceViewStates: new Map([['A', initial.viewState], ['B', other]]),
      });
      store.setViewState((draft) => { draft.crosshair.world_mm = [11, 22, 33]; }, 'A');
      expect(useViewStateStore.getState().viewState).toBe(other);
      expect(useViewStateStore.getState().workspaceViewStates.get('A')?.crosshair.world_mm).toEqual([11, 22, 33]);
      store.setViewState((draft) => { draft.crosshair.world_mm = [99, 99, 99]; }, 'closed');
      expect(useViewStateStore.getState().viewState).toBe(other);
    });

    it("rejects nonfinite input and no-ops repeated coordinates", async () => {
      const before = useViewStateStore.getState().viewState;
      await expect(store.setCrosshair([NaN, 0, 0])).rejects.toThrow();
      expect(useViewStateStore.getState().viewState).toBe(before);
      await store.setCrosshair(before.crosshair.world_mm);
      expect(useViewStateStore.getState().viewState).toBe(before);
    });

    it("keeps a delayed cursor in its originating workspace after tab switching", async () => {
      let finish!: () => void;
      const resize = new Promise<void>(resolve => { finish = resolve; });
      const initial = useViewStateStore.getState();
      const originKey = initial.activeWorkspaceKey;
      const other = structuredClone(initial.viewState);
      useViewStateStore.setState({ resizeInFlight: { axial: resize, sagittal: null, coronal: null } });
      const pending = store.setCrosshair([-29, 12, 20], true);
      useViewStateStore.setState({
        activeWorkspaceKey: 'other', viewState: other,
        workspaceViewStates: new Map([[originKey, initial.viewState], ['other', other]]),
      });
      finish(); await pending;
      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([0, 0, 0]);
      expect(useViewStateStore.getState().getWorkspaceViewState(originKey).crosshair.world_mm).toEqual([-29, 12, 20]);
    });

    it("does not let an older waiting cursor overwrite the latest navigation", async () => {
      let finish!: () => void;
      const resize = new Promise<void>(resolve => { finish = resolve; });
      useViewStateStore.setState({ resizeInFlight: { axial: resize, sagittal: null, coronal: null } });
      const old = store.setCrosshair([1, 2, 3], true);
      useViewStateStore.setState({ resizeInFlight: { axial: null, sagittal: null, coronal: null } });
      await store.setCrosshair([-29, 12, 20], true);
      finish(); await old;
      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([-29, 12, 20]);
    });

    it("keeps the newest resize and current crosshair when responses arrive out of order", async () => {
      useViewLayoutStore.getState().setMode('flexible');
      store.setViewState(state => { state.layers = [{ id: 'v', volumeId: 'vol', visible: true, opacity: 1 }] as any; });
      const base = structuredClone(useViewStateStore.getState().viewState.views.axial);
      let finishOld!: (value: typeof base) => void;
      let finishNew!: (value: typeof base) => void;
      recalcViewForDimensionsMock.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
        .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
      const old = store.updateDimensionsAndPreserveScale('axial', [640, 480]);
      const latest = store.updateDimensionsAndPreserveScale('axial', [800, 600]);
      await store.setCrosshair([-29, 12, 20], true);
      finishNew({ ...base, dim_px: [800, 600] }); await latest;
      finishOld({ ...base, dim_px: [640, 480] }); await old;
      const view = useViewStateStore.getState().viewState.views.axial;
      expect(view.dim_px).toEqual([800, 600]);
      expect(view.origin_mm[2]).toBe(20);
    });
  });

  describe("Locked layout fallbacks", () => {
    it("sizes the fallback frame to the volume bbox (centered), not the measured canvas", async () => {
      recalcAllViewsMock.mockRejectedValueOnce(
        new Error("backend unavailable"),
      );
      getVolumeBoundsMock.mockResolvedValueOnce({
        min: [-96, -132, -78],
        max: [96, 132, 78],
      });

      useViewLayoutStore.getState().setMode("locked");

      const testLayer = {
        id: "layer-1",
        name: "Test Layer",
        volumeId: "vol-1",
        visible: true,
        opacity: 1,
        isSelected: false,
        gpuStatus: "ready",
        render: {
          opacity: 1,
          colormap: "gray",
          intensityMin: 0,
          intensityMax: 1000,
          thresholdLow: 0,
          thresholdHigh: 0,
        },
      } as unknown as Layer;

      store.setViewState((state) => {
        state.layers = [testLayer];
        return state;
      });

      await store.updateDimensionsAndPreserveScale("axial", [640, 480]);

      expect(recalcAllViewsMock).toHaveBeenCalledTimes(1);
      expect(getVolumeBoundsMock).toHaveBeenCalledTimes(1);

      const updatedView = useViewStateStore.getState().viewState.views.axial;
      // Regression (orthogonal centering): the frontend fallback must size the
      // frame to the volume bounding box so the renderer letterbox-CENTERS the
      // tight image inside the (larger) canvas. Sizing it to the measured
      // canvas with a corner origin renders the volume flush-left -> the canvas
      // draws it 1:1 -> left-anchored (the bug seen when the plot dock resized
      // the slice panes). bounds 192x264mm @ [640,480]:
      //   pixelSize = max(192/640, 264/480) = 0.55
      //   dim_px = [ceil(192/0.55), ceil(264/0.55)] = [350, 480]  (volume aspect)
      // NOT the measured [640, 480] (canvas aspect).
      expect(updatedView.dim_px).toEqual([350, 480]);
      expect(updatedView.dim_px).not.toEqual([640, 480]);
      expect(updatedView.u_mm).not.toEqual([0, 0, 0]);
      expect(updatedView.v_mm).not.toEqual([0, 0, 0]);
    });
  });

  describe("Initial State", () => {
    it("should have correct initial view state", () => {
      const state = useViewStateStore.getState().viewState;

      expect(state.crosshair.world_mm).toEqual([0, 0, 0]);
      expect(state.crosshair.visible).toBe(true);
      expect(state.layers).toHaveLength(0);

      // Should have all three orthogonal views
      expect(state.views).toHaveProperty("axial");
      expect(state.views).toHaveProperty("sagittal");
      expect(state.views).toHaveProperty("coronal");

      // All views should be properly initialized
      Object.values(state.views).forEach((view) => {
        expect(view.dim_px).toEqual([512, 512]);
        // fov_mm and center_mm properties no longer exist after refactoring
      });
    });
  });

  describe("Crosshair Management", () => {
    it("should update crosshair position and sync view origins", async () => {
      const newPosition: WorldCoordinates = [10, 20, 30];

      // Act - Pass updateViews=true to sync view origins
      await store.setCrosshair(newPosition, true);

      // Assert - Crosshair should be updated
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual(newPosition);
      expect(state.crosshair.visible).toBe(true);

      // View origins should be updated to intersect at crosshair
      expect(state.views.axial.origin_mm[2]).toBe(30); // Z-coordinate
      expect(state.views.sagittal.origin_mm[0]).toBe(10); // X-coordinate
      expect(state.views.coronal.origin_mm[1]).toBe(20); // Y-coordinate
    });

    it("should increment revision counters for targeted crosshair and view updates", async () => {
      const initialRevisions = useViewStateStore.getState().viewStateRevisions;

      await store.setCrosshair([10, 20, 30], true);

      const nextRevisions = useViewStateStore.getState().viewStateRevisions;
      expect(nextRevisions.state).toBe(initialRevisions.state + 1);
      expect(nextRevisions.crosshair).toBe(initialRevisions.crosshair + 1);
      expect(nextRevisions.views.axial).toBe(initialRevisions.views.axial + 1);
      expect(nextRevisions.views.sagittal).toBe(
        initialRevisions.views.sagittal + 1,
      );
      expect(nextRevisions.views.coronal).toBe(
        initialRevisions.views.coronal + 1,
      );
      expect(nextRevisions.layers).toBe(initialRevisions.layers);
    });

    it("should handle crosshair visibility changes", async () => {
      // Act - Set position first, then change visibility
      await store.setCrosshair([5, 10, 15]);
      store.setCrosshairVisible(false);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual([5, 10, 15]);
      expect(state.crosshair.visible).toBe(false);
    });

    it("should coalesce rapid crosshair updates", async () => {
      // Act - Simulate rapid mouse movement
      const positions: WorldCoordinates[] = [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
        [4, 4, 4],
        [5, 5, 5],
      ];

      // Fire all updates without awaiting (rapid succession)
      positions.forEach((pos) => store.setCrosshair(pos));

      // Wait for last one to complete
      await store.setCrosshair([5, 5, 5]);

      // Assert - UI should show latest position immediately
      // Get fresh state after update
      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual(
        [5, 5, 5],
      );

      // Backend should not be called yet
      expect(mockBackendCallback).not.toHaveBeenCalled();
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
    });
  });

  describe("Layer Management", () => {
    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: "volume",
      visible: true,
      source: { type: "file", path: `/test/${id}.nii` },
    });

    it("should add layers correctly", () => {
      const layer = createTestLayer("layer1");

      // Act - Use setViewState with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer);
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0]).toEqual(layer);
    });

    it("should remove layers correctly", () => {
      const layer1 = createTestLayer("layer1");
      const layer2 = createTestLayer("layer2");

      // Arrange - Add both layers with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer1, layer2);
        return state;
      });
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(2);

      // Act - Remove layer1 with Immer direct mutation
      store.setViewState((state) => {
        state.layers = state.layers.filter((l) => l.id !== "layer1");
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].id).toBe("layer2");
    });

    it("should update layers correctly", () => {
      const layer = createTestLayer("updateLayer");

      // Arrange - Add layer with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer);
        return state;
      });

      // Act - Update layer with Immer direct mutation
      store.setViewState((state) => {
        const layerToUpdate = state.layers.find((l) => l.id === "updateLayer");
        if (layerToUpdate) {
          layerToUpdate.visible = false;
          layerToUpdate.name = "Updated Layer";
        }
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      const updatedLayer = state.layers.find((l) => l.id === "updateLayer");
      expect(updatedLayer?.visible).toBe(false);
      expect(updatedLayer?.name).toBe("Updated Layer");
    });

    it("should track layer revisions for setViewState mutations", () => {
      const initialRevisions = useViewStateStore.getState().viewStateRevisions;

      store.setViewState((state) => {
        state.layers.push(createTestLayer("layer-revision"));
        return state;
      });

      const nextRevisions = useViewStateStore.getState().viewStateRevisions;
      expect(nextRevisions.state).toBe(initialRevisions.state + 1);
      expect(nextRevisions.layers).toBe(initialRevisions.layers + 1);
      expect(nextRevisions.crosshair).toBe(initialRevisions.crosshair);
      expect(nextRevisions.views.axial).toBe(initialRevisions.views.axial);
    });

    it("should handle updating non-existent layer gracefully", () => {
      // Act & Assert - Should not throw
      expect(() => {
        store.setViewState((state) => {
          const layer = state.layers.find((l) => l.id === "nonexistent");
          if (layer) {
            layer.visible = false;
          }
          return state;
        });
      }).not.toThrow();

      // State should remain unchanged
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(0);
    });
  });

  describe("View Management", () => {
    it("should update individual views", () => {
      // After refactoring, ViewPlane no longer has: type, slice_mm, center_mm, normal_mm, fov_mm, origin_px
      const newAxialView = {
        u_mm: [1, 0, 0] as WorldCoordinates,
        v_mm: [0, 1, 0] as WorldCoordinates,
        dim_px: [256, 256] as [number, number],
        origin_mm: [10, 20, 30] as WorldCoordinates,
      };

      // Act
      store.updateView("axial", newAxialView);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.views.axial).toEqual(newAxialView);

      // Other views should remain unchanged (check initial values from getInitialViewState)
      expect(state.views.sagittal.origin_mm).toEqual([0, 100, 100]);
      expect(state.views.coronal.origin_mm).toEqual([-100, 0, 100]);
    });

    it("should provide helper methods for views", () => {
      // Test getView
      const axialView = store.getView("axial");
      // ViewPlane no longer has 'type' property after refactoring
      expect(axialView).toBeDefined();
      expect(axialView.dim_px).toEqual([512, 512]);

      // Test getViews
      const allViews = store.getViews();
      expect(allViews).toHaveProperty("axial");
      expect(allViews).toHaveProperty("sagittal");
      expect(allViews).toHaveProperty("coronal");
    });
  });

  describe("State Management", () => {
    it("should support custom state updates", () => {
      const customUpdate = (state: any) => {
        state.crosshair = {
          world_mm: [100, 200, 300],
          visible: false,
        };
        return state;
      };

      // Act
      store.setViewState(customUpdate);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual([100, 200, 300]);
      expect(state.crosshair.visible).toBe(false);
    });

    it("should handle void return from state updater", () => {
      const voidUpdate = (state: any) => {
        state.crosshair.visible = false;
        // No return value
      };

      // Act & Assert - Should not throw
      expect(() => {
        store.setViewState(voidUpdate);
      }).not.toThrow();
    });

    it("should reset to defaults correctly", async () => {
      // Arrange - Modify state
      await store.setCrosshair([50, 60, 70]);
      store.setViewState((state) => {
        state.layers.push(createTestLayer("testLayer"));
        return state;
      });

      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual(
        [50, 60, 70],
      );
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(1);

      // Act
      store.resetToDefaults();

      // Assert - Should be back to initial state
      // Get fresh state after reset
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual([0, 0, 0]);
      expect(state.crosshair.visible).toBe(true);
      expect(state.layers).toHaveLength(0);
    });

    it("preserves loaded layers when activating a workspace with an empty view-state snapshot", () => {
      const layer = {
        id: "template-layer",
        name: "MNI template",
        volumeId: "template-volume",
        visible: true,
        opacity: 1,
        colormap: "gray",
        intensity: [0, 100] as [number, number],
        threshold: [0, 0] as [number, number],
        blendMode: "alpha",
        interpolation: "linear",
      };

      store.setViewState((state) => {
        state.layers = [layer];
      });

      useWorkspaceStore.setState({
        workspaces: new Map([
          [
            "orthogonal-1",
            {
              id: "orthogonal-1",
              type: "orthogonal-flexible",
              title: "Orthogonal Panels",
              presetId: null,
              timestamp: 1,
              isActive: true,
              layoutConfig: {
                root: {
                  type: "component",
                  componentType: "Workspace",
                  title: "Orthogonal Panels",
                  componentState: {},
                },
              },
              panelStates: new Map(),
            },
          ],
        ]),
        activeWorkspaceId: "orthogonal-1",
      });

      const state = useViewStateStore.getState();
      expect(state.activeWorkspaceKey).toBe("orthogonal-1");
      expect(state.viewState.layers).toHaveLength(1);
      expect(state.viewState.layers[0].id).toBe("template-layer");
    });

    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: "volume",
      visible: true,
      source: { type: "file", path: `/test/${id}.nii` },
    });
  });

  describe("Undo/Redo Functionality", () => {
    it("should provide undo/redo methods", () => {
      // These methods are provided by temporal middleware
      expect(typeof store.undo).toBe("function");
      expect(typeof store.redo).toBe("function");
      expect(typeof store.canUndo).toBe("function");
      expect(typeof store.canRedo).toBe("function");
    });

    // Note: Actual undo/redo testing would require more complex setup
    // with the temporal middleware properly configured
  });

  describe("Coalescing Integration", () => {
    it("should coalesce multiple rapid state changes", async () => {
      // Act - Make multiple rapid changes
      store.setCrosshair([1, 1, 1]);
      store.setCrosshair([2, 2, 2]);
      store.setViewState((state) => {
        state.layers.push(createTestLayer("layer1"));
        return state;
      });
      // Await the last setCrosshair
      await store.setCrosshair([3, 3, 3]);

      // Assert - Should have pending update
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      expect(mockBackendCallback).not.toHaveBeenCalled();

      // UI should show latest state immediately
      // Get fresh state after updates
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual([3, 3, 3]);
      expect(state.layers).toHaveLength(1);
    });

    it("should allow manual flushing of coalesced updates", async () => {
      // Arrange
      await store.setCrosshair([10, 20, 30]);
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);

      // Act
      coalesceUtils.flush();
      await waitForFlush();

      // Assert
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
      expect(mockBackendCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          crosshair: {
            world_mm: [10, 20, 30],
            visible: true,
          },
        }),
        expect.objectContaining({
          state: expect.any(Number),
          crosshair: expect.any(Number),
        }),
      );
      expect(coalesceUtils.hasPendingUpdate()).toBe(false);
    });

    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: "volume",
      visible: true,
      source: { type: "file", path: `/test/${id}.nii` },
    });
  });
});
