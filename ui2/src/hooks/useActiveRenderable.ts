/**
 * useActiveRenderable
 *
 * Returns a stable callback that marks a given render context as active.
 * Components should call this from interaction handlers (mouseenter, mousedown,
 * mousemove, etc.). This avoids coupling to GoldenLayout focus.
 */

import { useCallback } from 'react';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';

export function useActiveRenderable(contextId: string) {
  return useCallback(() => {
    useActiveRenderContextStore.getState().setActive(contextId);
  }, [contextId]);
}

