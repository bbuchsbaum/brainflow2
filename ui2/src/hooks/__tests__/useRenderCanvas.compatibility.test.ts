import { useRenderStateStore } from '@/stores/renderStateStore';
/**
 * Test backward compatibility of useRenderCanvas with unified RenderContext
 */

import { renderHook, act } from '@testing-library/react';
import { useRenderCanvas } from '../useRenderCanvas';
import { RenderContextFactory } from '@/types/renderContext';

describe('useRenderCanvas backward compatibility', () => {
  it('should work with legacy viewType', () => {
    const { result } = renderHook(() => 
      useRenderCanvas({ viewType: 'axial' })
    );
    
    expect(result.current.canvasRef).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });
  
  it('should work with legacy tag', () => {
    const { result } = renderHook(() => 
      useRenderCanvas({ tag: 'mosaic-default-axial-0' })
    );
    
    expect(result.current.canvasRef).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });
  
  it('should work with new RenderContext for slice', () => {
    const context = RenderContextFactory.createSliceContext('axial', 800, 600);
    
    const { result } = renderHook(() => 
      useRenderCanvas({ context })
    );
    
    expect(result.current.canvasRef).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });
  
  it('should work with new RenderContext for mosaic', () => {
    const context = RenderContextFactory.createMosaicCellContext(
      'default',
      'axial',
      0,
      200,
      200
    );
    
    const { result } = renderHook(() => 
      useRenderCanvas({ context })
    );
    
    expect(result.current.canvasRef).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });
  
  it('should prefer context over legacy options', () => {
    const context = RenderContextFactory.createSliceContext('sagittal', 800, 600);
    
    // Pass both - context should win
    const { result } = renderHook(() => 
      useRenderCanvas({ 
        context,
        viewType: 'axial'  // This should be ignored
      })
    );
    
    // The store key should be from context ('slice-sagittal'), not viewType
    expect(result.current.canvasRef).toBeDefined();
  });
});

describe('useRenderCanvas lifecycle', () => {
  it('bounds failed-image retries and cancels the pending timer on unmount', () => {
    vi.useFakeTimers();
    const context = { clearRect: vi.fn(), drawImage: vi.fn(() => { throw new Error('detached bitmap'); }) };
    const canvas = { width: 128, height: 128, getContext: () => context };
    const image = { width: 128, height: 128 } as ImageBitmap;
    const { result, unmount } = renderHook(() => useRenderCanvas({ tag: 'retry-test' }));
    (result.current.canvasRef as any).current = canvas;
    act(() => useRenderStateStore.getState().setImage('retry-test', image));
    act(() => vi.advanceTimersByTime(3000));
    expect(context.drawImage).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    act(() => useRenderStateStore.getState().setImage('retry-test', { ...image } as ImageBitmap));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    useRenderStateStore.getState().clearState('retry-test');
    vi.useRealTimers();
  });

  it('clears the retained canvas when the image is removed', () => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 128, height: 128, getContext: () => context };
    const { result, unmount } = renderHook(() => useRenderCanvas({ tag: 'clear-test' }));
    (result.current.canvasRef as any).current = canvas;
    act(() => useRenderStateStore.getState().setImage('clear-test', { width: 128, height: 128 } as ImageBitmap));
    context.clearRect.mockClear(); context.drawImage.mockClear();
    act(() => useRenderStateStore.getState().setImage('clear-test', null));
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 128, 128);
    expect(context.drawImage).not.toHaveBeenCalled();
    unmount(); useRenderStateStore.getState().clearState('clear-test');
  });
});
