import { useMemo } from 'react';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  createDefaultSurfaceViewSelection,
  useSurfaceStore,
} from '@/stores/surfaceStore';
import type { SurfaceCommandContext } from '@/utils/surfaceCommandContext';
import {
  resolveActiveSurfaceSelection,
  resolveExplicitSurfaceViewId,
  resolveSurfaceViewState,
} from '@/utils/surfaceViewContext';

export function useSurfaceCommandContextValue(): SurfaceCommandContext {
  const activeSurfaceId = useSurfaceStore((state) => state.activeSurfaceId);
  const selectedItemType = useSurfaceStore((state) => state.selectedItemType);
  const selectedLayerId = useSurfaceStore((state) => state.selectedLayerId);
  const surfaceViewHandles = useSurfaceStore((state) => state.surfaceViewHandles);
  const surfaceViewSelections = useSurfaceStore((state) => state.surfaceViewSelections);
  const activeRenderableId = useActiveRenderContextStore((state) => state.activeId);
  const activePanelType = useActivePanelStore((state) => state.componentType);
  const activePanelState = useActivePanelStore((state) => state.componentState);

  return useMemo(() => {
    const explicitSurfaceViewId = resolveExplicitSurfaceViewId({
      surfaceViewHandles,
      activeRenderableId,
      activePanelType,
      activePanelState,
    });
    const selection = resolveActiveSurfaceSelection({
      activeSurfaceId,
      selectedItemType,
      selectedLayerId,
      surfaceViewHandles,
      surfaceViewSelections,
      activeRenderableId,
      activePanelType,
      activePanelState,
    });

    return {
      ...selection,
      explicitSurfaceViewId,
    };
  }, [
    activePanelState,
    activePanelType,
    activeRenderableId,
    activeSurfaceId,
    selectedItemType,
    selectedLayerId,
    surfaceViewHandles,
    surfaceViewSelections,
  ]);
}

export function useResolvedSurfaceViewState(
  surfaceViewId: string | null | undefined,
  fallbackSurfaceHandle?: string | null
) {
  const surfaceViewSelections = useSurfaceStore((state) => state.surfaceViewSelections);
  const surfaceViewHandles = useSurfaceStore((state) => state.surfaceViewHandles);

  return useMemo(() => {
    if (!surfaceViewId) {
      return {
        ...createDefaultSurfaceViewSelection(fallbackSurfaceHandle ?? null),
        surfaceViewId: null,
        boundSurfaceId: fallbackSurfaceHandle ?? null,
        renderAnchorSurfaceId: fallbackSurfaceHandle ?? null,
      };
    }

    return resolveSurfaceViewState(
      surfaceViewId,
      surfaceViewHandles,
      surfaceViewSelections,
      fallbackSurfaceHandle
    );
  }, [fallbackSurfaceHandle, surfaceViewHandles, surfaceViewId, surfaceViewSelections]);
}
