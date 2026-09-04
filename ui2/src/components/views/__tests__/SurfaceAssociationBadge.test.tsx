/**
 * Phase 5c — Surface association states (missing / loaded-unlinked / loaded-linked).
 *
 * The badge surfaces the relationship between the loaded surfaces and the
 * loaded volumes inside the integrated workspace's surface region. Tests
 * cover state resolution + rendering for all three kinds plus reactive
 * updates when stores change.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { SurfaceAssociationBadge } from "../SurfaceAssociationBadge";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { useLayerStore } from "@/stores/layerStore";

vi.mock("@/services/SurfaceLoadingService", () => ({
  getSurfaceLoadingService: () => ({
    requestSurfaceFileSelection: vi.fn().mockResolvedValue(undefined),
  }),
}));

function resetStores() {
  act(() => {
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
    });
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

interface SeedSurfaceArgs {
  id: string;
  name: string;
  visible?: boolean;
  sourceVolumeId?: string;
  path?: string;
}

function seedSurfaces(
  args: ReadonlyArray<SeedSurfaceArgs>,
  activeId: string | null = null,
) {
  act(() => {
    useSurfaceStore.setState({
      surfaces: new Map(
        args.map((surface) => [
          surface.id,
          {
            handle: surface.id,
            name: surface.name,
            visible: surface.visible ?? true,
            geometry: {
              vertices: new Float32Array(),
              faces: new Uint32Array(),
            },
            layers: new Map() as never,
            metadata: {
              vertexCount: 1024,
              faceCount: 2048,
              hemisphere: "left",
              surfaceType: "pial",
              path: surface.path ?? `/tmp/${surface.id}.gii`,
              sourceVolumeId: surface.sourceVolumeId,
            },
          } as never,
        ]),
      ),
      activeSurfaceId: activeId,
      selectedItemType: activeId ? "geometry" : null,
      selectedLayerId: null,
    });
  });
}

function seedVolume(id: string, name: string) {
  act(() => {
    useLayerStore.setState({
      layers: [
        {
          id,
          name,
          volumeId: id,
          type: "anatomical",
          visible: true,
          order: 0,
        } as never,
      ],
      selectedLayerId: id,
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
    });
  });
}

describe("SurfaceAssociationBadge", () => {
  beforeEach(() => {
    resetStores();
  });

  it("renders nothing when no surface is loaded (SurfaceViewPanel owns the load CTA)", () => {
    render(<SurfaceAssociationBadge />);

    // The badge defers its missing-state to the SurfaceViewPanel empty-state to
    // avoid a duplicate "Load surface" control in the same region (Design.md §22).
    expect(screen.queryByTestId("surface-association-badge")).toBeNull();
    expect(screen.queryByTestId("surface-association-load")).toBeNull();
  });

  it('renders the loaded-unlinked state with reason="no-source-id" when the surface has no source volume', () => {
    seedSurfaces([{ id: "surf-1", name: "lh.pial" }], "surf-1");

    render(<SurfaceAssociationBadge />);

    const badge = screen.getByTestId("surface-association-badge");
    expect(badge.getAttribute("data-state")).toBe("loaded-unlinked");
    expect(badge.getAttribute("data-reason")).toBe("no-source-id");
    expect(screen.getByTestId("surface-association-state").textContent).toMatch(
      /unlinked/i,
    );
    expect(
      screen.getByTestId("surface-association-detail").textContent,
    ).toMatch(/no source volume/i);
  });

  it('renders loaded-unlinked with reason="source-not-loaded" when sourceVolumeId references a missing volume', () => {
    seedSurfaces(
      [{ id: "surf-1", name: "lh.pial", sourceVolumeId: "never-loaded" }],
      "surf-1",
    );

    render(<SurfaceAssociationBadge />);

    const badge = screen.getByTestId("surface-association-badge");
    expect(badge.getAttribute("data-state")).toBe("loaded-unlinked");
    expect(badge.getAttribute("data-reason")).toBe("source-not-loaded");
    expect(
      screen.getByTestId("surface-association-detail").textContent,
    ).toMatch(/not loaded/i);
  });

  it("renders loaded-linked when surface.sourceVolumeId matches a current volume layer", () => {
    seedVolume("vol-1", "BOLD run-01");
    seedSurfaces(
      [{ id: "surf-1", name: "lh.pial", sourceVolumeId: "vol-1" }],
      "surf-1",
    );

    render(<SurfaceAssociationBadge />);

    const badge = screen.getByTestId("surface-association-badge");
    expect(badge.getAttribute("data-state")).toBe("loaded-linked");
    expect(screen.getByTestId("surface-association-state").textContent).toMatch(
      /linked/i,
    );
    expect(
      screen.getByTestId("surface-association-volume").textContent,
    ).toContain("BOLD run-01");
  });

  it("renders the template-underlay state for an auto-mounted templateflow surface", () => {
    seedSurfaces(
      [
        {
          id: "tpl-1",
          name: "fsaverage L pial",
          path: "templateflow://fsaverage_pial_L",
        },
      ],
      "tpl-1",
    );

    render(<SurfaceAssociationBadge />);

    const badge = screen.getByTestId("surface-association-badge");
    expect(badge.getAttribute("data-state")).toBe("template-underlay");
    expect(screen.getByTestId("surface-association-state").textContent).toMatch(
      /template surface/i,
    );
  });

  it('explains why an inflated mesh without anatomical correspondence cannot navigate the volume', () => {
    seedSurfaces([{ id: 'inflated', name: 'Inflated', path: '/sub-01/lh.inflated.gii' }], 'inflated');
    act(() => useSurfaceStore.setState(state => {
      const surfaces = new Map(state.surfaces);
      const surface = surfaces.get('inflated')!;
      surfaces.set('inflated', { ...surface, geometry: { ...surface.geometry, surfaceType: 'inflated' },
        metadata: { ...surface.metadata, surfaceType: 'inflated' } });
      return { surfaces };
    }));
    render(<SurfaceAssociationBadge />);
    expect(screen.getByTestId('surface-association-badge')).toHaveAttribute('data-state', 'cursor-unavailable');
    expect(screen.getByText(/load matching pial/i)).toBeInTheDocument();
  });

  it("reactively transitions absent → loaded-unlinked → loaded-linked", () => {
    render(<SurfaceAssociationBadge />);

    // No surface → badge is absent (panel empty-state owns the invitation).
    expect(screen.queryByTestId("surface-association-badge")).toBeNull();

    seedSurfaces([{ id: "surf-1", name: "lh.pial" }], "surf-1");

    expect(
      screen
        .getByTestId("surface-association-badge")
        .getAttribute("data-state"),
    ).toBe("loaded-unlinked");

    seedVolume("vol-1", "T1w");
    seedSurfaces(
      [{ id: "surf-1", name: "lh.pial", sourceVolumeId: "vol-1" }],
      "surf-1",
    );

    expect(
      screen
        .getByTestId("surface-association-badge")
        .getAttribute("data-state"),
    ).toBe("loaded-linked");
  });

  it("prefers the active surface; falls back to the first visible when active is hidden", () => {
    seedVolume("vol-1", "T1w");
    seedSurfaces(
      [
        {
          id: "surf-1",
          name: "lh.pial",
          visible: false,
          sourceVolumeId: "vol-1",
        },
        { id: "surf-2", name: "rh.pial" }, // visible, no sourceVolumeId
      ],
      "surf-1",
    );

    render(<SurfaceAssociationBadge />);

    // Active surf-1 is hidden; anchor falls through to first visible (surf-2),
    // which has no sourceVolumeId → loaded-unlinked.
    expect(
      screen
        .getByTestId("surface-association-badge")
        .getAttribute("data-state"),
    ).toBe("loaded-unlinked");
  });
});
