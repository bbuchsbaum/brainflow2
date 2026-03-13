export interface SurfaceViewContext {
  surfaceHandle: string;
  surfaceViewId: string;
}

export interface SurfaceSelectionSnapshot {
  activeSurfaceId: string | null;
  selectedItemType: 'geometry' | 'dataLayer' | null;
  selectedLayerId: string | null;
}

export interface ResolvedSurfaceViewState extends SurfaceSelectionSnapshot {
  surfaceViewId: string | null;
  boundSurfaceId: string | null;
  renderAnchorSurfaceId: string | null;
}

interface SurfaceViewResolutionInput {
  activeSurfaceId: string | null | undefined;
  surfaceViewHandles: Map<string, string>;
  activeRenderableId?: string | null;
  activePanelType?: string | null;
  activePanelState?: Record<string, unknown> | null;
}

interface SurfaceSelectionResolutionInput extends SurfaceViewResolutionInput {
  selectedItemType?: SurfaceSelectionSnapshot['selectedItemType'];
  selectedLayerId?: string | null;
  surfaceViewSelections?: Map<string, SurfaceSelectionSnapshot>;
}

const SURFACE_VIEW_PREFIX = 'surfaceview:';

export function buildSurfaceViewContextId(
  surfaceHandle: string,
  surfaceViewId: string
): string {
  return `${SURFACE_VIEW_PREFIX}${surfaceHandle}:${surfaceViewId}`.toLowerCase();
}

export function parseSurfaceViewContextId(
  contextId: string | null | undefined
): SurfaceViewContext | null {
  if (!contextId) {
    return null;
  }

  const normalized = contextId.toLowerCase();
  if (!normalized.startsWith(SURFACE_VIEW_PREFIX)) {
    return null;
  }

  const payload = normalized.slice(SURFACE_VIEW_PREFIX.length);
  const separator = payload.indexOf(':');
  if (separator <= 0 || separator === payload.length - 1) {
    return null;
  }

  return {
    surfaceHandle: payload.slice(0, separator),
    surfaceViewId: payload.slice(separator + 1),
  };
}

export function findSurfaceViewIdForSurface(
  surfaceViewHandles: Map<string, string>,
  surfaceHandle: string | null | undefined
): string | null {
  if (!surfaceHandle) {
    return null;
  }

  for (const [surfaceViewId, handle] of surfaceViewHandles.entries()) {
    if (handle === surfaceHandle) {
      return surfaceViewId;
    }
  }

  return null;
}

export function findSurfaceHandleForViewId(
  surfaceViewHandles: Map<string, string>,
  surfaceViewId: string | null | undefined
): string | null {
  if (!surfaceViewId) {
    return null;
  }

  return surfaceViewHandles.get(surfaceViewId) ?? null;
}

export function resolveBoundSurfaceHandle(
  surfaceViewId: string | null | undefined,
  surfaceViewHandles: Map<string, string>,
  fallbackSurfaceHandle?: string | null
): string | null {
  return findSurfaceHandleForViewId(surfaceViewHandles, surfaceViewId) ?? fallbackSurfaceHandle ?? null;
}

export function resolveScopedSurfaceViewIdForSurface(
  surfaceViewId: string | null | undefined,
  surfaceId: string | null | undefined,
  surfaceViewHandles: Map<string, string>
): string | null {
  if (!surfaceViewId) {
    return null;
  }

  const boundSurfaceId = findSurfaceHandleForViewId(surfaceViewHandles, surfaceViewId);
  if (!boundSurfaceId || !surfaceId || boundSurfaceId !== surfaceId) {
    return null;
  }

  return surfaceViewId;
}

export function resolveSurfaceViewState(
  surfaceViewId: string | null | undefined,
  surfaceViewHandles: Map<string, string>,
  surfaceViewSelections?: Map<string, SurfaceSelectionSnapshot>,
  fallbackSurfaceHandle?: string | null
): ResolvedSurfaceViewState {
  const boundSurfaceId = resolveBoundSurfaceHandle(
    surfaceViewId,
    surfaceViewHandles,
    fallbackSurfaceHandle
  );
  const scopedSelection =
    (surfaceViewId ? surfaceViewSelections?.get(surfaceViewId) : null) ??
    {
      activeSurfaceId: boundSurfaceId,
      selectedItemType: boundSurfaceId ? 'geometry' : null,
      selectedLayerId: null,
    };
  const selectedSurfaceId = scopedSelection.activeSurfaceId ?? boundSurfaceId ?? null;
  const selectedItemType =
    selectedSurfaceId === null ? null : (scopedSelection.selectedItemType ?? 'geometry');

  return {
    surfaceViewId: surfaceViewId ?? null,
    boundSurfaceId,
    activeSurfaceId: selectedSurfaceId,
    selectedItemType,
    selectedLayerId:
      selectedItemType === 'dataLayer' ? (scopedSelection.selectedLayerId ?? null) : null,
    renderAnchorSurfaceId: boundSurfaceId ?? selectedSurfaceId,
  };
}

export function resolveSurfaceViewIdFromPanelState(
  componentType: string | null | undefined,
  componentState: Record<string, unknown> | null | undefined,
  surfaceViewHandles?: Map<string, string>,
  activeSurfaceId?: string | null
): string | null {
  if (componentType?.toLowerCase() !== 'surfaceview') {
    return null;
  }

  const surfaceViewId =
    typeof componentState?.surfaceViewId === 'string' ? componentState.surfaceViewId : null;
  if (!surfaceViewId) {
    return null;
  }

  if (!activeSurfaceId) {
    return surfaceViewId;
  }

  const panelSurfaceHandle =
    typeof componentState?.surfaceHandle === 'string'
      ? componentState.surfaceHandle
      : findSurfaceHandleForViewId(surfaceViewHandles ?? new Map(), surfaceViewId);

  return !panelSurfaceHandle || panelSurfaceHandle === activeSurfaceId ? surfaceViewId : null;
}

export function resolveActiveSurfaceViewId({
  activeSurfaceId,
  surfaceViewHandles,
  activeRenderableId,
  activePanelType,
  activePanelState,
}: SurfaceViewResolutionInput): string | null {
  const explicitSurfaceViewId = resolveExplicitSurfaceViewId({
    surfaceViewHandles,
    activeRenderableId,
    activePanelType,
    activePanelState,
  });
  if (explicitSurfaceViewId) {
    return explicitSurfaceViewId;
  }

  return findSurfaceViewIdForSurface(surfaceViewHandles, activeSurfaceId);
}

export function resolveExplicitSurfaceViewId({
  surfaceViewHandles,
  activeRenderableId,
  activePanelType,
  activePanelState,
}: Omit<SurfaceViewResolutionInput, 'activeSurfaceId'>): string | null {
  const activePanelSurfaceViewId = resolveSurfaceViewIdFromPanelState(
    activePanelType,
    activePanelState,
    surfaceViewHandles,
    undefined
  );
  if (activePanelSurfaceViewId) {
    return activePanelSurfaceViewId;
  }

  const activeRenderableSurfaceView = parseSurfaceViewContextId(activeRenderableId);
  if (activeRenderableSurfaceView) {
    return activeRenderableSurfaceView.surfaceViewId;
  }

  return null;
}

export function resolveActiveSurfaceSelection({
  activeSurfaceId,
  selectedItemType,
  selectedLayerId,
  surfaceViewHandles,
  surfaceViewSelections,
  activeRenderableId,
  activePanelType,
  activePanelState,
}: SurfaceSelectionResolutionInput): SurfaceSelectionSnapshot & { surfaceViewId: string | null } {
  const surfaceViewId = resolveActiveSurfaceViewId({
    activeSurfaceId,
    surfaceViewHandles,
    activeRenderableId,
    activePanelType,
    activePanelState,
  });

  if (surfaceViewId) {
    const scopedSelection = surfaceViewSelections?.get(surfaceViewId);
    if (scopedSelection) {
      return {
        surfaceViewId,
        activeSurfaceId: scopedSelection.activeSurfaceId,
        selectedItemType: scopedSelection.selectedItemType,
        selectedLayerId: scopedSelection.selectedLayerId,
      };
    }

    const boundSurfaceHandle = findSurfaceHandleForViewId(surfaceViewHandles, surfaceViewId);
    return {
      surfaceViewId,
      activeSurfaceId: boundSurfaceHandle,
      selectedItemType: boundSurfaceHandle ? 'geometry' : null,
      selectedLayerId: null,
    };
  }

  return {
    surfaceViewId: null,
    activeSurfaceId: activeSurfaceId ?? null,
    selectedItemType: selectedItemType ?? null,
    selectedLayerId: selectedLayerId ?? null,
  };
}

export function buildSurfaceViewExporterKey(
  componentType: string | null | undefined,
  componentState: Record<string, unknown> | null | undefined,
  surfaceViewHandles?: Map<string, string>
): string | null {
  const surfaceViewId = resolveSurfaceViewIdFromPanelState(
    componentType,
    componentState,
    surfaceViewHandles
  );
  if (!surfaceViewId) {
    return null;
  }

  const fallbackSurfaceHandle =
    typeof componentState?.surfaceHandle === 'string' ? componentState.surfaceHandle : null;
  const surfaceHandle = resolveBoundSurfaceHandle(
    surfaceViewId,
    surfaceViewHandles ?? new Map(),
    fallbackSurfaceHandle
  );
  if (!surfaceHandle) {
    return null;
  }

  return buildSurfaceViewContextId(surfaceHandle, surfaceViewId);
}
