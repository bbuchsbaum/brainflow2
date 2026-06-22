/**
 * Surface-side resolution for "View on surface" (vol2surf M8).
 *
 * Decides what the surface side should be when projecting a volume:
 *
 *   explicit            → at least one surface is loaded; use the active one
 *                         (else the first loaded surface).
 *   auto-mount-template → no surface loaded, but the volume is in a template
 *                         space (MNI) for which a canonical template surface can
 *                         serve as the underlay.
 *   none                → no surface and no template space to fall back to; the
 *                         caller should prompt the user to load a surface.
 *
 * Pure logic only — the actual mounting/projection (async, app-side) lives in
 * the layer-panel handler. Kept separate so the decision is unit-testable
 * without the GPU app.
 */

export type SurfaceProjectionTarget =
  | { readonly kind: "explicit"; readonly surfaceId: string }
  | { readonly kind: "auto-mount-template"; readonly space: "MNI" }
  | { readonly kind: "none" };

export interface ResolveSurfaceProjectionTargetParams {
  /** Surface ids currently loaded (store keys / backend handles). */
  readonly loadedSurfaceIds: readonly string[];
  /** Active surface id, if any (preferred when loaded). */
  readonly activeSurfaceId?: string | null;
  /**
   * Coordinate-space tag of the volume being projected, as reported by
   * `get_nifti_header_info` (vol2surf M6): "MNI", "scanner", "unknown", …
   */
  readonly volumeSpace?: string | null;
}

/**
 * Resolve the surface-side target for a projection. See module docs for the
 * order: explicit loaded surface → MNI template fallback → none.
 */
export function resolveSurfaceProjectionTarget(
  params: ResolveSurfaceProjectionTargetParams,
): SurfaceProjectionTarget {
  const { loadedSurfaceIds, activeSurfaceId, volumeSpace } = params;

  if (loadedSurfaceIds.length > 0) {
    const surfaceId =
      activeSurfaceId && loadedSurfaceIds.includes(activeSurfaceId)
        ? activeSurfaceId
        : loadedSurfaceIds[0];
    return { kind: "explicit", surfaceId };
  }

  if (isMniSpace(volumeSpace)) {
    return { kind: "auto-mount-template", space: "MNI" };
  }

  return { kind: "none" };
}

/** True when the space tag denotes MNI (the only auto-mountable space today). */
export function isMniSpace(volumeSpace: string | null | undefined): boolean {
  return typeof volumeSpace === "string" && volumeSpace.toUpperCase() === "MNI";
}

/**
 * True when a surface originated from a template catalog (its path uses the
 * `templateflow://` scheme set by `load_surface_template`). Used to badge an
 * auto-mounted surface as an "MNI template underlay" rather than "unlinked".
 */
export function isTemplateSurfacePath(
  path: string | null | undefined,
): boolean {
  return typeof path === "string" && path.startsWith("templateflow://");
}
