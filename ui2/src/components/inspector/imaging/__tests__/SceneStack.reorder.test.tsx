import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SceneItem, SceneStackGroups } from "@/types/sceneItem";

function volume(id: string, name: string, kind: SceneItem["kind"]): SceneItem {
  return {
    id,
    kind,
    group: "volume",
    name,
    subtitle: kind === "volume-base" ? "base volume" : "volume overlay",
    visible: true,
    opacity: 1,
    ref: { type: "volume", layerId: id },
  };
}

let stack: SceneStackGroups = {
  volumes: [
    volume("v1", "Accuracy.nii.gz", "volume-base"),
    volume("v2", "MNI152 T1w", "volume-overlay"),
  ],
  surfaces: [
    {
      id: "s1",
      kind: "surface-geometry",
      group: "surface",
      name: "fsaverage L",
      subtitle: "surface geometry",
      visible: true,
      opacity: 1,
      ref: { type: "surface-geometry", surfaceId: "s1" },
    },
  ],
  mappings: [],
  totalCount: 3,
};

vi.mock("@/hooks/useSceneStack", () => ({
  useSceneStack: () => stack,
}));

const setActiveSpy = vi.fn();
type InspectorSelectionState = {
  activeItemId: string | null;
  activeItemKind: null;
  setActive: typeof setActiveSpy;
};
vi.mock("@/stores/inspectorSelectionStore", () => ({
  useInspectorSelectionStore: (
    selector: (s: InspectorSelectionState) => unknown,
  ) =>
    selector({
      activeItemId: null,
      activeItemKind: null,
      setActive: setActiveSpy,
    }),
}));

const reorderLayers = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/LayerService", () => ({
  getLayerService: () => ({ reorderLayers }),
}));

import { SceneStack } from "../SceneStack";

describe("SceneStack reordering", () => {
  beforeEach(() => {
    setActiveSpy.mockClear();
    reorderLayers.mockClear();
    stack = {
      volumes: [
        volume("v1", "Accuracy.nii.gz", "volume-base"),
        volume("v2", "MNI152 T1w", "volume-overlay"),
      ],
      surfaces: stack.surfaces,
      mappings: [],
      totalCount: 3,
    };
  });

  it("renders a drag handle on each volume row when there are 2+ volumes", () => {
    render(<SceneStack />);
    expect(
      screen.getByLabelText("Drag to reorder Accuracy.nii.gz"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Drag to reorder MNI152 T1w"),
    ).toBeInTheDocument();
    // Surfaces are not reorderable here — no handle for the surface row.
    expect(screen.queryByLabelText("Drag to reorder fsaverage L")).toBeNull();
  });

  it("does not render a drag handle when there is only one volume", () => {
    stack = {
      volumes: [volume("v1", "Accuracy.nii.gz", "volume-base")],
      surfaces: stack.surfaces,
      mappings: [],
      totalCount: 2,
    };
    render(<SceneStack />);
    expect(screen.queryByLabelText(/Drag to reorder/)).toBeNull();
    // The row itself still renders and is selectable.
    expect(screen.getByText("Accuracy.nii.gz")).toBeInTheDocument();
  });

  it("still selects a layer when its row is clicked (drag handle does not hijack click)", () => {
    render(<SceneStack />);
    fireEvent.click(screen.getByText("MNI152 T1w"));
    expect(setActiveSpy).toHaveBeenCalledTimes(1);
    expect(setActiveSpy.mock.calls[0][0].id).toBe("v2");
  });
});
