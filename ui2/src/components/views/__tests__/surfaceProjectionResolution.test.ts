import { describe, it, expect } from "vitest";

import {
  isMniSpace,
  isTemplateSurfacePath,
  resolveSurfaceProjectionTarget,
} from "@/components/views/surfaceProjectionResolution";

describe("resolveSurfaceProjectionTarget (vol2surf M8)", () => {
  it("uses the active surface when one is loaded", () => {
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: ["surf-a", "surf-b"],
        activeSurfaceId: "surf-b",
        volumeSpace: "MNI",
      }),
    ).toEqual({ kind: "explicit", surfaceId: "surf-b" });
  });

  it("falls back to the first loaded surface when the active id is not loaded", () => {
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: ["surf-a", "surf-b"],
        activeSurfaceId: "stale",
        volumeSpace: "scanner",
      }),
    ).toEqual({ kind: "explicit", surfaceId: "surf-a" });
  });

  it("auto-mounts a template when no surface is loaded and the volume is MNI", () => {
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: [],
        volumeSpace: "MNI",
      }),
    ).toEqual({ kind: "auto-mount-template", space: "MNI" });
  });

  it("returns none when no surface is loaded and the volume is not MNI", () => {
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: [],
        volumeSpace: "scanner",
      }),
    ).toEqual({ kind: "none" });
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: [],
        volumeSpace: undefined,
      }),
    ).toEqual({ kind: "none" });
  });

  it("prefers an explicit surface even for a non-MNI volume", () => {
    expect(
      resolveSurfaceProjectionTarget({
        loadedSurfaceIds: ["surf-a"],
        activeSurfaceId: null,
        volumeSpace: "unknown",
      }),
    ).toEqual({ kind: "explicit", surfaceId: "surf-a" });
  });
});

describe("isMniSpace", () => {
  it("matches MNI case-insensitively, nothing else", () => {
    expect(isMniSpace("MNI")).toBe(true);
    expect(isMniSpace("mni")).toBe(true);
    expect(isMniSpace("scanner")).toBe(false);
    expect(isMniSpace("unknown")).toBe(false);
    expect(isMniSpace(null)).toBe(false);
    expect(isMniSpace(undefined)).toBe(false);
  });
});

describe("isTemplateSurfacePath", () => {
  it("detects the templateflow:// scheme set by load_surface_template", () => {
    expect(isTemplateSurfacePath("templateflow://fsaverage_pial_L")).toBe(true);
    expect(isTemplateSurfacePath("/data/sub-01_pial.surf.gii")).toBe(false);
    expect(isTemplateSurfacePath("<memory>")).toBe(false);
    expect(isTemplateSurfacePath(null)).toBe(false);
    expect(isTemplateSurfacePath(undefined)).toBe(false);
  });
});
