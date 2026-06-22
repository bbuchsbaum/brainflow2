/**
 * Helpers for the integrated workspace's surface-association affordance
 * (Phase 5c of the integrated workspace refactor).
 *
 * The surface region answers a single question: "What is the relationship
 * between the loaded surfaces and the loaded volumes right now?"
 *
 *   missing         → no surfaces loaded
 *   loaded-unlinked → at least one surface loaded, none of which carries a
 *                     `sourceVolumeId` pointing at a currently-loaded volume
 *   loaded-linked   → the active surface (or the first visible one) carries a
 *                     `sourceVolumeId` matching a currently-loaded volume
 *
 * The selection rule mirrors `SurfaceViewPanel.collectRenderSurfaces`:
 * prefer the active surface, otherwise pick the first visible surface.
 *
 * Implementation note: subscribes to primitive fields individually so
 * Zustand v5 doesn't loop infinitely on object-returning selectors.
 */

import { useLayerStore } from "@/stores/layerStore";
import { useSurfaceStore } from "@/stores/surfaceStore";

import { isTemplateSurfacePath } from "./surfaceProjectionResolution";

export type SurfaceAssociationKind =
  | "missing"
  | "loaded-unlinked"
  | "loaded-linked"
  | "template-underlay";

export interface SurfaceAssociationMissing {
  readonly kind: "missing";
}

export interface SurfaceAssociationUnlinked {
  readonly kind: "loaded-unlinked";
  readonly surfaceId: string;
  readonly surfaceName: string;
  /**
   * Why we couldn't find a link. `'no-source-id'` = the surface metadata
   * has no `sourceVolumeId` at all. `'source-not-loaded'` = the surface
   * names a sourceVolumeId but no current volume layer matches.
   */
  readonly reason: "no-source-id" | "source-not-loaded";
}

export interface SurfaceAssociationLinked {
  readonly kind: "loaded-linked";
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly volumeLayerId: string;
  readonly volumeName: string;
}

/**
 * The anchor surface was auto-mounted from a template catalog (its path uses
 * the `templateflow://` scheme) and is serving as an MNI underlay rather than a
 * subject-specific surface linked by `sourceVolumeId` (vol2surf M8).
 */
export interface SurfaceAssociationTemplateUnderlay {
  readonly kind: "template-underlay";
  readonly surfaceId: string;
  readonly surfaceName: string;
}

export type SurfaceAssociationState =
  | SurfaceAssociationMissing
  | SurfaceAssociationUnlinked
  | SurfaceAssociationLinked
  | SurfaceAssociationTemplateUnderlay;

/**
 * Picks the surface that drives the association badge. Mirrors
 * `collectRenderSurfaces`: active surface first, otherwise the first
 * visible surface. Returns null when no surface is selectable.
 */
function pickAnchorSurfaceId(
  surfaceIds: readonly string[],
  visibility: ReadonlyMap<string, boolean>,
  activeSurfaceId: string | null,
): string | null {
  if (surfaceIds.length === 0) return null;

  if (activeSurfaceId && surfaceIds.includes(activeSurfaceId)) {
    if (visibility.get(activeSurfaceId) !== false) return activeSurfaceId;
  }
  for (const id of surfaceIds) {
    if (visibility.get(id) !== false) return id;
  }
  return activeSurfaceId ?? surfaceIds[0];
}

/**
 * Reactive hook returning the current surface association state. Re-renders
 * only when the relevant primitives change.
 */
export function useSurfaceAssociationState(): SurfaceAssociationState {
  // ---- Surface side --------------------------------------------------------
  const surfaceCount = useSurfaceStore((s) => s.surfaces.size);
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);

  // Snapshot the keys once per render — Map iteration order is stable, but
  // we still want to avoid returning a fresh array from a selector.
  const surfaceIdsKey = useSurfaceStore((s) =>
    Array.from(s.surfaces.keys()).join("|"),
  );
  const visibilityKey = useSurfaceStore((s) => {
    let parts = "";
    s.surfaces.forEach((surface, id) => {
      parts += `${id}:${surface.visible === false ? "0" : "1"};`;
    });
    return parts;
  });

  // The anchor surface's id, name, and sourceVolumeId. We split into separate
  // primitive selectors so Zustand v5 doesn't churn on object identity.
  const anchorId = useSurfaceStore((s) => {
    const surfaceIds = Array.from(s.surfaces.keys());
    const visibility = new Map<string, boolean>();
    s.surfaces.forEach((surface, id) =>
      visibility.set(id, surface.visible !== false),
    );
    return pickAnchorSurfaceId(surfaceIds, visibility, s.activeSurfaceId);
  });
  const anchorName = useSurfaceStore((s) => {
    if (!anchorId) return undefined;
    return s.surfaces.get(anchorId)?.name;
  });
  const anchorSourceVolumeId = useSurfaceStore((s) => {
    if (!anchorId) return undefined;
    return s.surfaces.get(anchorId)?.metadata.sourceVolumeId;
  });
  const anchorPath = useSurfaceStore((s) => {
    if (!anchorId) return undefined;
    return s.surfaces.get(anchorId)?.metadata.path;
  });

  // ---- Volume side ---------------------------------------------------------
  // Look up the matched volume layer by id (no array-shape selectors — those
  // would create new refs on every layer mutation).
  const volumeLayerName = useLayerStore((s) => {
    if (!anchorSourceVolumeId) return undefined;
    return s.layers.find((l) => l.id === anchorSourceVolumeId)?.name;
  });

  void surfaceCount;
  void surfaceIdsKey;
  void visibilityKey;
  void activeSurfaceId;

  if (!anchorId || !anchorName) {
    return { kind: "missing" };
  }

  if (!anchorSourceVolumeId) {
    // An auto-mounted template surface (templateflow:// path) has no
    // sourceVolumeId by design — it's an underlay, not "unlinked" (vol2surf M8).
    if (isTemplateSurfacePath(anchorPath)) {
      return {
        kind: "template-underlay",
        surfaceId: anchorId,
        surfaceName: anchorName,
      };
    }
    return {
      kind: "loaded-unlinked",
      surfaceId: anchorId,
      surfaceName: anchorName,
      reason: "no-source-id",
    };
  }

  if (!volumeLayerName) {
    return {
      kind: "loaded-unlinked",
      surfaceId: anchorId,
      surfaceName: anchorName,
      reason: "source-not-loaded",
    };
  }

  return {
    kind: "loaded-linked",
    surfaceId: anchorId,
    surfaceName: anchorName,
    volumeLayerId: anchorSourceVolumeId,
    volumeName: volumeLayerName,
  };
}
