/**
 * The Scene section's readout row must not change geometry as the pointer
 * moves (user report 2026-11-13: "At pointer · ijk 80, 41, 53 (obs)" wrapped
 * to two lines and pushed the layer rows down on every move). jsdom has no
 * layout, so this pins the contract that guarantees it: a fixed-height,
 * single-line row whose caption truncates (full text in the tooltip), and
 * value cells with a shared width floor in tabular figures.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SceneItem, SceneStackGroups } from "@/types/sceneItem";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useLayerStore } from "@/stores/layerStore";

vi.mock("@/events/EventBus", () => ({ getEventBus: () => ({ emit: vi.fn(), on: vi.fn(() => () => {}) }) }));

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
  volumes: [volume("base", "MNI152 T1w (1mm)"), volume("obs", "obs")],
  surfaces: [],
  mappings: [],
  totalCount: 2,
};
vi.mock("@/hooks/useSceneStack", () => ({ useSceneStack: () => stack }));
vi.mock("@/stores/inspectorSelectionStore", () => ({
  useInspectorSelectionStore: (selector: (s: object) => unknown) =>
    selector({ activeItemId: "obs", activeItemKind: "volume-overlay", setActive: vi.fn() }),
}));
vi.mock("@/services/LayerService", () => ({
  getLayerService: () => ({ reorderLayers: vi.fn(), moveLayerByUser: vi.fn(), toggleVisibility: vi.fn() }),
}));

let source: "pointer" | "crosshair" = "crosshair";
vi.mock("@/hooks/useReadoutPoint", () => ({
  useReadoutPoint: () => ({ world: [0, 0, 0], source }),
}));
vi.mock("@/hooks/useReadoutGrid", () => ({
  useReadoutGrid: () => ({ layerId: "obs", name: "contrast-xold_cue_lure_t_g.nii.gz", label: "obs", dims: [91, 109, 91] }),
  useIjkSuffix: () => "obs",
}));
vi.mock("@/utils/voxelSnap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/voxelSnap")>()),
  worldToVoxelIndex: () => [80, 41, 53],
  voxelIndexInBounds: () => true,
  formatVoxelIndex: (i: number[]) => i.join(", "),
}));

const values: Record<string, number> = { base: 1504, obs: 0 };
vi.mock("@/hooks/useLayerValueAtWorld", () => ({
  useLayerValueAtWorld: (layerId: string) => ({ layerId, value: values[layerId] }),
}));

import { SceneStack } from "../SceneStack";
import { READOUT_MIN_WIDTH } from "../LayerReadoutValue";

function rowGeometry() {
  const row = screen.getByTestId("scene-readout-row");
  const label = screen.getByText("Volume view");
  const caption = screen.getByTestId("scene-readout-caption");
  return { row: row.className, label: label.className, caption: caption.className };
}

describe("SceneStack readout row keeps its layout as the pointer moves", () => {
  beforeEach(() => {
    source = "crosshair";
    values.base = 1504;
    values.obs = 0;
    const current = useViewStateStore.getState().viewState;
    useViewStateStore.setState({
      viewState: {
        ...current,
        layers: [
          { id: "base", visible: true, opacity: 1 },
          { id: "obs", visible: true, opacity: 1 },
        ] as typeof current.layers,
      },
    });
    useLayerStore.setState({
      layers: [
        { id: "base", name: "MNI152 T1w (1mm)", volumeId: "base", type: "volume", visible: true, order: 0 },
        { id: "obs", name: "obs", volumeId: "obs", type: "volume", visible: true, order: 1 },
      ] as never,
    });
  });

  it("is a fixed-height single line in the crosshair and the pointer state alike", () => {
    const { rerender } = render(<SceneStack />);
    const crosshair = rowGeometry();
    expect(screen.getByTestId("scene-readout-caption")).toHaveTextContent(/^At crosshair$/);

    source = "pointer";
    rerender(<SceneStack />);
    const caption = screen.getByTestId("scene-readout-caption");
    expect(caption).toHaveTextContent("At pointer · ijk 80, 41, 53 (obs)");

    // Identical geometry classes in both states: nothing about the row depends
    // on which text it shows.
    expect(rowGeometry()).toEqual(crosshair);

    const row = screen.getByTestId("scene-readout-row");
    expect(row).toHaveClass("h-6", "items-center", "overflow-hidden");
    // The label never wraps or gives way to the caption.
    expect(screen.getByText("Volume view")).toHaveClass("shrink-0", "whitespace-nowrap");
    // The caption shrinks and ends in an ellipsis instead of wrapping.
    expect(caption).toHaveClass("min-w-0", "truncate", "whitespace-nowrap");
    // …with the full readout in its tooltip.
    expect(caption.getAttribute("title")).toContain("At pointer · ijk 80, 41, 53 (obs)");
    expect(caption.getAttribute("title")).toContain("contrast-xold_cue_lure_t_g.nii.gz");
  });

  it("gives every value cell the same width floor in tabular figures, whatever the value", () => {
    const { rerender } = render(<SceneStack />);
    const cells = () => [screen.getByTestId("layer-readout-base"), screen.getByTestId("layer-readout-obs")];
    const before = cells().map((c) => c.className);
    for (const cell of cells()) {
      expect(cell).toHaveClass(READOUT_MIN_WIDTH, "tabular-nums", "font-mono", "whitespace-nowrap", "text-right");
    }

    values.base = 8230;
    values.obs = 2.38;
    source = "pointer";
    rerender(<SceneStack />);
    expect(screen.getByTestId("layer-readout-base")).toHaveTextContent("8230");
    expect(screen.getByTestId("layer-readout-obs")).toHaveTextContent("2.38");
    expect(cells().map((c) => c.className)).toEqual(before);
  });
});
