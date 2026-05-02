import { useEffect } from 'react';
import { useRenderStateStore } from '@/stores/renderStateStore';
import type { RenderContext } from '@/types/renderContext';

export function useRenderContextRegistration(context: RenderContext): void {
  useEffect(() => {
    // Register after commit so dimension changes update the context in place
    // without clearing the retained render state for the same viewport.
    useRenderStateStore.getState().registerContext(context);
  }, [context]);

  useEffect(() => {
    return () => {
      useRenderStateStore.getState().clearContext(context.id);
    };
  }, [context.id]);
}
