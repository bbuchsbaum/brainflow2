import { renderHook } from '@testing-library/react';
import { describe, expect, beforeEach, it } from 'vitest';
import { useRenderContextRegistration } from '../useRenderContextRegistration';
import { useRenderStateStore } from '@/stores/renderStateStore';
import type { RenderContext } from '@/types/renderContext';

function createContext(width: number, height: number): RenderContext {
  return {
    id: 'axial',
    type: 'slice',
    dimensions: { width, height },
    metadata: { viewType: 'axial' },
  };
}

describe('useRenderContextRegistration', () => {
  beforeEach(() => {
    useRenderStateStore.setState({ states: {}, contexts: {} });
  });

  it('preserves cached render state when dimensions change for the same context id', () => {
    const image = new ImageBitmap();
    const { rerender } = renderHook(({ context }: { context: RenderContext }) => {
      useRenderContextRegistration(context);
    }, {
      initialProps: { context: createContext(512, 512) },
    });

    useRenderStateStore.getState().setImage('axial', image);

    rerender({ context: createContext(640, 512) });

    const store = useRenderStateStore.getState();
    expect(store.getContext('axial')?.dimensions).toEqual({ width: 640, height: 512 });
    expect(store.getState('axial').lastImage).toBe(image);
  });

  it('clears the context state on unmount', () => {
    const { unmount } = renderHook(({ context }: { context: RenderContext }) => {
      useRenderContextRegistration(context);
    }, {
      initialProps: { context: createContext(512, 512) },
    });

    expect(useRenderStateStore.getState().getContext('axial')).toBeDefined();

    unmount();

    expect(useRenderStateStore.getState().getContext('axial')).toBeUndefined();
    expect(useRenderStateStore.getState().getAllStates()).not.toHaveProperty('axial');
  });
});
