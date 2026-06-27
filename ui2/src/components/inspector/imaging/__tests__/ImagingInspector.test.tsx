import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SceneItem, SceneStackGroups } from "@/types/sceneItem";

const sampleStack: SceneStackGroups = {
  volumes: [
    {
      id: "v1",
      kind: "volume-base",
      group: "volume",
      name: "MNI152 T1w",
      subtitle: "base volume · MNI · 1mm",
      visible: true,
      opacity: 1,
      ref: { type: "volume", layerId: "v1" },
    },
    {
      id: "v2",
      kind: "volume-overlay",
      group: "volume",
      name: "sub-01 t-map",
      subtitle: "volume overlay · 4D · MNI",
      visible: true,
      opacity: 0.85,
      ref: { type: "volume", layerId: "v2" },
    },
  ],
  surfaces: [
    {
      id: "s1",
      kind: "surface-geometry",
      group: "surface",
      name: "fsaverage L",
      subtitle: "surface geometry · 163k vertices",
      visible: true,
      opacity: 1,
      ref: { type: "surface-geometry", surfaceId: "s1" },
    },
  ],
  mappings: [],
  totalCount: 3,
};

vi.mock("@/hooks/useSceneStack", () => ({
  useSceneStack: () => sampleStack,
}));

let activeId: string | null = null;
const setActiveSpy = vi.fn();

vi.mock("@/stores/inspectorSelectionStore", () => ({
  useInspectorSelectionStore: (selector: any) =>
    selector({
      activeItemId: activeId,
      activeItemKind: null,
      setActive: setActiveSpy,
    }),
}));

// Minimal store mocks for sections that read from stores
vi.mock("@/stores/layerStore", () => ({
  useLayerStore: (selector?: any) => {
    const state = {
      layers: [
        { id: "v1", name: "MNI152 T1w", type: "volume", visible: true },
        { id: "v2", name: "sub-01 t-map", type: "volume", visible: true },
      ],
      layerMetadata: new Map(),
      selectedLayerId: null,
      updateLayer: vi.fn(),
      selectLayer: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/stores/viewStateStore", () => ({
  useViewStateStore: (selector: any) =>
    selector({
      // `crosshair` is a required field of the real viewState (always
      // initialized in viewStateStore); RenderSection reads
      // `crosshair.world_mm`, so the mock must include it.
      viewState: { layers: [], crosshair: { world_mm: [0, 0, 0] } },
      setViewState: vi.fn(),
    }),
}));

vi.mock("@/stores/surfaceStore", async (importOriginal) => ({
  // Keep the real named exports (DEFAULT_SURFACE_MATERIAL_SETTINGS etc. are
  // imported at module load by surfaceAppearancePresets); only stub the hook.
  ...(await importOriginal<typeof import("@/stores/surfaceStore")>()),
  useSurfaceStore: (selector: any) =>
    selector({
      surfaces: new Map(),
      setSurfaceVisibility: vi.fn(),
    }),
}));

import { ImagingInspector } from "../ImagingInspector";

describe("ImagingInspector", () => {
  beforeEach(() => {
    activeId = null;
    setActiveSpy.mockClear();
  });

  it("renders Volume View and non-empty Surface View; hides empty Mappings group", () => {
    render(<ImagingInspector />);
    // Volume View is always rendered; Surface View shows because the sample
    // stack has one surface; Mappings group is hidden because it's empty
    // (Stage A: empty groups no longer render permanent rail noise).
    expect(screen.getByText("Volume View")).toBeInTheDocument();
    expect(screen.getByText("Surface View")).toBeInTheDocument();
    expect(screen.queryByText("Mappings")).not.toBeInTheDocument();
  });

  it("lists scene items by name", () => {
    render(<ImagingInspector />);
    expect(screen.getByText("MNI152 T1w")).toBeInTheDocument();
    expect(screen.getByText("sub-01 t-map")).toBeInTheDocument();
    expect(screen.getByText("fsaverage L")).toBeInTheDocument();
  });

  it("clicking a Scene Stack item invokes setActive with the matching scene item", () => {
    render(<ImagingInspector />);
    fireEvent.click(screen.getByText("MNI152 T1w"));
    expect(setActiveSpy).toHaveBeenCalled();
    const arg = setActiveSpy.mock.calls[0][0] as SceneItem;
    expect(arg.id).toBe("v1");
    expect(arg.kind).toBe("volume-base");
  });

  it("shows the no-selection hint when nothing is active", () => {
    render(<ImagingInspector />);
    expect(screen.getByText(/Select a scene item/i)).toBeInTheDocument();
  });

  it("renders contextual sections (Render) when an item is selected", () => {
    activeId = "v2";
    render(<ImagingInspector />);
    // Stage A: the standalone "Selected" header block has been removed; the
    // Scene row's selected ring conveys selection. Sections still render
    // immediately when an item is active.
    expect(screen.queryByText(/Selected/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Render/i)).toBeInTheDocument();
  });
});
