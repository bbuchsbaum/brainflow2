import { useMemo } from 'react';
import { findLayerIdForSourcePath } from '@/services/studio/StudioDisplayService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

const SEPARATOR = '\n';

/** The active view's layer ids as one string: a primitive, stable while they are. */
function selectViewLayerKey(state: ReturnType<typeof useViewStateStore.getState>): string {
  return state.viewState.layers.map((layer) => layer.id).join(SEPARATOR);
}

/**
 * The layer loaded from `sourcePath` that the active view draws, or null.
 * The layer store holds every workspace's layers: a copy of the image open
 * in another tab is not one a Studio view can show, so it is not found.
 */
export function useStudioLayerId(sourcePath: string | null | undefined): string | null {
  const viewKey = useViewStateStore(selectViewLayerKey);
  const inView = useMemo(() => new Set(viewKey ? viewKey.split(SEPARATOR) : []), [viewKey]);
  return useLayerStore((state) => findLayerIdForSourcePath(state, sourcePath, inView));
}
