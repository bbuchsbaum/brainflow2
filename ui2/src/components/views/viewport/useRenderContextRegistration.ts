import { useEffect } from 'react';
import { useRenderStateStore } from '@/stores/renderStateStore';
import type { RenderContext } from '@/types/renderContext';

export function useRenderContextRegistration(context: RenderContext): void {
  useEffect(() => {
    const store = useRenderStateStore.getState();
    const existing = store.getContext?.(context.id);
    if (!existing) {
      store.registerContext(context);
    } else {
      const { width, height } = context.dimensions;
      const dimsChanged =
        existing.dimensions?.width !== width || existing.dimensions?.height !== height;
      const typeChanged = existing.type !== context.type;

      if (dimsChanged || typeChanged) {
        const syncContext = () => useRenderStateStore.getState().registerContext(context);
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(syncContext);
        } else {
          setTimeout(syncContext, 16);
        }
      }
    }

    return () => {
      useRenderStateStore.getState().clearContext(context.id);
    };
  }, [context]);
}
