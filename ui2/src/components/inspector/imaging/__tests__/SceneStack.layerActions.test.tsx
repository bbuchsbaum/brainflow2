import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SceneItem, SceneStackGroups } from "@/types/sceneItem";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useLoadingQueueStore } from "@/stores/loadingQueueStore";
import { useViewStateStore } from "@/stores/viewStateStore";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/events/EventBus", () => ({ getEventBus: () => ({ emit: notify, on: vi.fn(() => () => {}) }) }));

function volume(id: string, name: string): SceneItem {
  return {
    id,
    kind: "volume-overlay",
    group: "volume",
    name,
    subtitle: "volume overlay",
    visible: true,
    opacity: 1,
    ref: { type: "volume", layerId: id },
  };
}

const stack: SceneStackGroups = {
  volumes: [volume("v1", "T1w"), volume("v2", "zstat1")],
  surfaces: [],
  mappings: [],
  totalCount: 2,
};

vi.mock("@/hooks/useSceneStack", () => ({ useSceneStack: () => stack }));

let activeItemId: string | null = "v2";
const setActiveSpy = vi.fn();
vi.mock("@/stores/inspectorSelectionStore", () => ({
  useInspectorSelectionStore: (selector: (s: object) => unknown) =>
    selector({ activeItemId, activeItemKind: "volume-overlay", setActive: setActiveSpy }),
}));

const removeLayerFromScene = vi.fn().mockResolvedValue(true);
vi.mock("@/services/layerRemoval", () => ({
  removeLayerFromScene: (id: string) => removeLayerFromScene(id),
}));

const toggleVisibility = vi.fn();
vi.mock("@/services/LayerService", () => ({
  getLayerService: () => ({ reorderLayers: vi.fn(), moveLayerByUser: vi.fn(), toggleVisibility }),
}));

import { SceneStack } from "../SceneStack";

describe("SceneStack layer actions (QA §5.2: no way to remove a layer)", () => {
  beforeEach(() => {
    activeItemId = "v2";
    setActiveSpy.mockClear();
    removeLayerFromScene.mockClear();
    toggleVisibility.mockClear();
    useContextMenuStore.getState().close();
  });

  it("right-click selects the row and offers Remove layer", () => {
    render(<SceneStack />);
    fireEvent.contextMenu(screen.getByText("T1w"));
    expect(setActiveSpy.mock.calls[0][0].id).toBe("v1");
    const menu = useContextMenuStore.getState();
    expect(menu.isOpen).toBe(true);
    const remove = menu.items.find((item) => item.id === "layer.remove");
    expect(remove?.label).toBe("Remove layer");
    remove?.onClick?.();
    expect(removeLayerFromScene).toHaveBeenCalledWith("v1");
  });

  it("the menu hides and shows the layer through the layer service", () => {
    render(<SceneStack />);
    fireEvent.contextMenu(screen.getByText("zstat1"));
    useContextMenuStore.getState().items.find((item) => item.id === "layer.toggleVisible")?.onClick?.();
    expect(toggleVisibility).toHaveBeenCalledWith("v2", false);
  });

  it("Delete and Backspace in the list remove the selected layer", () => {
    render(<SceneStack />);
    const rows = screen.getAllByRole("row");
    fireEvent.keyDown(rows[1], { key: "Delete" });
    expect(removeLayerFromScene).toHaveBeenLastCalledWith("v2");
    fireEvent.keyDown(rows[0], { key: "Backspace" });
    expect(removeLayerFromScene).toHaveBeenCalledTimes(2);
  });

  it("a modified Delete does nothing", () => {
    render(<SceneStack />);
    fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Backspace", metaKey: true });
    expect(removeLayerFromScene).not.toHaveBeenCalled();
  });

  it("Delete with no selected layer does nothing", () => {
    activeItemId = null;
    render(<SceneStack />);
    fireEvent.keyDown(screen.getAllByRole("row")[0], { key: "Delete" });
    expect(removeLayerFromScene).not.toHaveBeenCalled();
  });

  it("a held Delete (auto-repeat) does not remove more layers", () => {
    render(<SceneStack />);
    fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Delete", repeat: true });
    expect(removeLayerFromScene).not.toHaveBeenCalled();
  });

  describe("Delete while an image is opening (QA 2026-10-30 F35)", () => {
    const workspace = () => useViewStateStore.getState().activeWorkspaceKey;
    const open = (workspaceId: string) =>
      useLoadingQueueStore.getState().enqueue({ type: "volume-load", path: `/d/${workspaceId}.nii`, displayName: "t1.nii", workspaceId });
    beforeEach(() => notify.mockClear());

    it("an open into this workspace since the selection blocks Delete, with a toast", () => {
      render(<SceneStack />);
      const id = open(workspace());
      try {
        fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Delete" });
        expect(removeLayerFromScene).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith("ui.notification", expect.objectContaining({ type: "warning" }));
      } finally {
        useLoadingQueueStore.getState().cancel(id);
      }
      fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Delete" });
      expect(removeLayerFromScene).toHaveBeenCalledWith("v2");
    });

    it("loads into another workspace, or without one (Studio population), do not block", () => {
      render(<SceneStack />);
      const other = open("another-workspace");
      const population = useLoadingQueueStore.getState().enqueue({ type: "volume-load", path: "/d/member.nii", displayName: "member" });
      try {
        fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Delete" });
        expect(removeLayerFromScene).toHaveBeenCalledWith("v2");
      } finally {
        useLoadingQueueStore.getState().cancel(other);
        useLoadingQueueStore.getState().cancel(population);
      }
    });

    it("a load already running when the row was selected does not block", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1000);
        const id = open(workspace());
        vi.setSystemTime(2000);
        render(<SceneStack />);
        fireEvent.keyDown(screen.getAllByRole("row")[1], { key: "Delete" });
        expect(removeLayerFromScene).toHaveBeenCalledWith("v2");
        useLoadingQueueStore.getState().cancel(id);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
