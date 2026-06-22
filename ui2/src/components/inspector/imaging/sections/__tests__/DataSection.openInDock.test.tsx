/**
 * DataSection "Open in dock" affordance.
 *
 * Clicking the link reveals the shared plot dock
 * (`layoutSettingsStore.plotDockOpen`) and targets the inspected layer
 * (`layerStore.selectLayer`) so the dock plots it. Mode resolution is left to
 * the dock's auto policy, so this asserts only the open + selection effects.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { SceneItem } from "@/types/sceneItem";
import { useLayerStore } from "@/stores/layerStore";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

import { DataSection } from "../DataSection";

function volumeItem(layerId: string): SceneItem {
  return {
    id: layerId,
    kind: "volume-base",
    group: "volume",
    name: "MNI152 T1w",
    subtitle: "base volume",
    visible: true,
    opacity: 1,
    ref: { type: "volume", layerId },
  } as SceneItem;
}

describe("DataSection · Open in dock", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
    useLayerStore.getState().selectLayer(null);
  });

  it("opens the plot dock and selects the inspected layer on click", () => {
    expect(useLayoutSettingsStore.getState().plotDockOpen).toBe(false);

    render(<DataSection item={volumeItem("layer-42")} />);
    fireEvent.click(screen.getByTestId("open-in-dock"));

    expect(useLayoutSettingsStore.getState().plotDockOpen).toBe(true);
    expect(useLayerStore.getState().selectedLayerId).toBe("layer-42");
  });

  it("does not render the link for non-plottable kinds", () => {
    const surfaceGeometry = {
      id: "s1",
      kind: "surface-geometry",
      group: "surface",
      name: "fsaverage L",
      subtitle: "surface geometry",
      visible: true,
      opacity: 1,
      ref: { type: "surface-geometry", surfaceId: "s1" },
    } as SceneItem;

    render(<DataSection item={surfaceGeometry} />);
    expect(screen.queryByTestId("open-in-dock")).toBeNull();
  });
});
