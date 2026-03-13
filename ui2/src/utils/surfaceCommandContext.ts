import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  type SurfaceSelectionItemType,
} from '@/stores/surfaceStore';
import {
  resolveActiveSurfaceSelection,
  resolveExplicitSurfaceViewId,
  resolveScopedSurfaceViewIdForSurface,
  type SurfaceSelectionSnapshot,
} from './surfaceViewContext';

export interface SurfaceCommandContext extends SurfaceSelectionSnapshot {
  surfaceViewId: string | null;
  explicitSurfaceViewId: string | null;
}

export function getActiveSurfaceCommandContext(): SurfaceCommandContext {
  const surfaceState = useSurfaceStore.getState();
  const activePanel = useActivePanelStore.getState();
  const activeRenderableId = useActiveRenderContextStore.getState().activeId;

  const explicitSurfaceViewId = resolveExplicitSurfaceViewId({
    surfaceViewHandles: surfaceState.surfaceViewHandles,
    activeRenderableId,
    activePanelType: activePanel.componentType,
    activePanelState: activePanel.componentState,
  });

  const selection = resolveActiveSurfaceSelection({
    activeSurfaceId: surfaceState.activeSurfaceId,
    selectedItemType: surfaceState.selectedItemType,
    selectedLayerId: surfaceState.selectedLayerId,
    surfaceViewHandles: surfaceState.surfaceViewHandles,
    surfaceViewSelections: surfaceState.surfaceViewSelections,
    activeRenderableId,
    activePanelType: activePanel.componentType,
    activePanelState: activePanel.componentState,
  });

  return {
    ...selection,
    explicitSurfaceViewId,
  };
}

export function resolveSurfaceTargetSurfaceId(
  context: Pick<SurfaceCommandContext, 'activeSurfaceId'>,
  surfaces: Map<string, unknown>
): string | null {
  return context.activeSurfaceId ?? surfaces.keys().next().value ?? null;
}

export function resolveSurfaceSelectionViewId(
  surfaceId: string | null,
  surfaceViewId: string | null | undefined = getActiveSurfaceCommandContext().explicitSurfaceViewId
): string | null {
  if (!surfaceId) {
    return null;
  }

  const surfaceStore = useSurfaceStore.getState();
  return resolveScopedSurfaceViewIdForSurface(
    surfaceViewId,
    surfaceId,
    surfaceStore.surfaceViewHandles
  );
}

export function applySurfaceSelectionInContext(
  surfaceId: string | null,
  itemType: SurfaceSelectionItemType,
  layerId: string | null = null,
  surfaceViewId: string | null | undefined = getActiveSurfaceCommandContext().explicitSurfaceViewId
): void {
  const surfaceStore = useSurfaceStore.getState();
  const scopedSurfaceViewId = resolveSurfaceSelectionViewId(surfaceId, surfaceViewId);

  if (scopedSurfaceViewId) {
    surfaceStore.setSurfaceSelectionForView(scopedSurfaceViewId, surfaceId, itemType, layerId);
    return;
  }

  surfaceStore.setCompatibilitySelection(surfaceId, itemType, layerId);
}
