import type { LoadedSurface } from '@/stores/surfaceStore';
import {
  resolveSurfaceSceneIdentity,
  type TemplateflowSurfaceIdentity,
} from '@/utils/surfaceIdentity';

function parseTemplateIdentity(surface: LoadedSurface): TemplateflowSurfaceIdentity | null {
  return resolveSurfaceSceneIdentity({
    path: surface.metadata?.path,
    geometryHemisphere: surface.geometry.hemisphere,
    metadataHemisphere: surface.metadata?.hemisphere,
    surfaceType: surface.geometry.surfaceType || surface.metadata?.surfaceType || '',
  });
}

function hemisphereSortRank(surface: LoadedSurface): number {
  const hemisphere = (
    surface.geometry.hemisphere ||
    surface.metadata?.hemisphere ||
    ''
  ).toLowerCase();
  if (hemisphere === 'left') return 0;
  if (hemisphere === 'right') return 1;
  return 2;
}

function chooseHemisphereCandidate(
  candidates: LoadedSurface[],
  preferredSurfaceType: string,
  preferredHandle?: string,
): LoadedSurface | null {
  if (candidates.length === 0) {
    return null;
  }

  if (preferredHandle) {
    const byHandle = candidates.find((surface) => surface.handle === preferredHandle);
    if (byHandle) {
      return byHandle;
    }
  }

  if (preferredSurfaceType) {
    const byType = candidates.find((surface) => {
      const candidateType = (
        surface.geometry.surfaceType ||
        surface.metadata?.surfaceType ||
        ''
      ).toLowerCase();
      return candidateType === preferredSurfaceType;
    });
    if (byType) {
      return byType;
    }
  }

  return candidates[0];
}

function surfaceGroupKeyOf(surface: LoadedSurface): string | null {
  return parseTemplateIdentity(surface)?.basePath ?? null;
}

function scopeToGroup(
  surfaces: Map<string, LoadedSurface>,
  groupKey: string,
): Map<string, LoadedSurface> {
  return new Map(
    Array.from(surfaces.entries()).filter(([, surface]) => surfaceGroupKeyOf(surface) === groupKey),
  );
}

export function collectRenderSurfaces(
  surfaces: Map<string, LoadedSurface>,
  activeSurfaceId: string | null,
  groupKey?: string | null,
  pinnedSurfaceHandle?: string | null,
): LoadedSurface[] {
  if (surfaces.size === 0) {
    return [];
  }

  // When the host panel is pinned to a scene group (a standalone surface tab),
  // only surfaces in that group are eligible. Panels without a group key
  // (e.g. the Integrated workspace pane) keep global anchor-pairing behavior.
  let scoped = groupKey != null ? scopeToGroup(surfaces, groupKey) : surfaces;

  // A pinned key that matches nothing while the tab's own surface is loaded
  // means the tab and surface disagree on identity. Scope to that surface's
  // scene instead of drawing an empty (black) viewport.
  const pinnedAnchor = pinnedSurfaceHandle ? surfaces.get(pinnedSurfaceHandle) : undefined;
  if (groupKey != null && scoped.size === 0 && pinnedAnchor) {
    const anchorKey = surfaceGroupKeyOf(pinnedAnchor);
    console.warn(
      '[SurfaceView] Pinned scene group matches no loaded surface; using the tab surface scene',
      { groupKey, anchorKey, anchor: pinnedAnchor.handle, path: pinnedAnchor.metadata?.path },
    );
    scoped =
      anchorKey != null
        ? scopeToGroup(surfaces, anchorKey)
        : new Map([[pinnedAnchor.handle, pinnedAnchor]]);
  }

  if (scoped.size === 0) {
    return [];
  }

  const activeSurface = activeSurfaceId ? scoped.get(activeSurfaceId) : null;
  const visibleSurfaces = Array.from(scoped.values()).filter(
    (surface) => surface.visible !== false,
  );
  const anchorSurface =
    activeSurface && activeSurface.visible !== false
      ? activeSurface
      : (visibleSurfaces[0] ?? activeSurface);

  if (!anchorSurface) {
    return [];
  }

  const anchorIdentity = parseTemplateIdentity(anchorSurface);
  if (!anchorIdentity) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  const templateVisible = visibleSurfaces
    .map((surface) => ({ surface, identity: parseTemplateIdentity(surface) }))
    .filter(
      (
        entry,
      ): entry is {
        surface: LoadedSurface;
        identity: TemplateflowSurfaceIdentity;
      } => !!entry.identity && entry.identity.basePath === anchorIdentity.basePath,
    );
  if (templateVisible.length === 0) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  const leftCandidates = templateVisible
    .filter((entry) => entry.identity.hemisphere === 'left')
    .map((entry) => entry.surface);
  const rightCandidates = templateVisible
    .filter((entry) => entry.identity.hemisphere === 'right')
    .map((entry) => entry.surface);

  const preferredType = anchorIdentity.surfaceType;
  const preferredLeftHandle =
    anchorIdentity.hemisphere === 'left' ? anchorSurface.handle : undefined;
  const preferredRightHandle =
    anchorIdentity.hemisphere === 'right' ? anchorSurface.handle : undefined;

  const selectedLeft = chooseHemisphereCandidate(
    leftCandidates,
    preferredType,
    preferredLeftHandle,
  );
  const selectedRight = chooseHemisphereCandidate(
    rightCandidates,
    preferredType,
    preferredRightHandle,
  );
  const pairedVisible = [selectedLeft, selectedRight].filter(
    (surface): surface is LoadedSurface => surface !== null,
  );

  if (pairedVisible.length === 0) {
    return anchorSurface.visible === false ? [] : [anchorSurface];
  }

  pairedVisible.sort((a, b) => hemisphereSortRank(a) - hemisphereSortRank(b));
  return pairedVisible;
}
