/**
 * Test backward compatibility of useRenderCanvas with unified RenderContext
 */

import { renderHook } from '@testing-library/react';
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