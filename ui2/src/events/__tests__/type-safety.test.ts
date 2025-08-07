/**
 * Type safety tests for EventBus
 * These tests verify that our type helpers provide compile-time safety
 */

import { emitTyped, getEventBus } from '../EventBus';

describe('EventBus type safety', () => {
  it('should emit events with correct types', () => {
    const eventBus = getEventBus();
    
    // Set up a listener to verify the event is received
    let received: any = null;
    eventBus.on('render.complete', (data) => {
      received = data;
    });
    
    // Create a mock ImageBitmap
    const mockBitmap = {} as ImageBitmap;
    
    // Use the type-safe emit helper
    emitTyped('render.complete', {
      viewType: 'axial',
      imageBitmap: mockBitmap
    });
    
    // Verify the event was received
    expect(received).toEqual({
      viewType: 'axial',
      imageBitmap: mockBitmap
    });
  });
  
  it('should work with original emit method too', () => {
    const eventBus = getEventBus();
    
    let received: any = null;
    eventBus.on('crosshair.updated', (data) => {
      received = data;
    });
    
    // Original method still works
    eventBus.emit('crosshair.updated', {
      world_mm: [10, 20, 30]
    });
    
    expect(received).toEqual({
      world_mm: [10, 20, 30]
    });
  });
  
  // TypeScript compile-time tests (these won't run, but will fail to compile if types are wrong)
  it('type checking examples (compile-time only)', () => {
    // These are just to verify TypeScript catches errors at compile time
    
    // ✅ Correct usage
    emitTyped('render.complete', {
      viewType: 'axial',
      imageBitmap: {} as ImageBitmap
    });
    
    // The following would cause TypeScript errors (commented out):
    
    // ❌ Wrong event name
    // emitTyped('render.complte', { ... }); // TypeScript error: typo
    
    // ❌ Wrong payload type
    // emitTyped('render.complete', { 
    //   viewType: 123 // TypeScript error: should be string
    // });
    
    // ❌ Missing required fields
    // emitTyped('render.complete', {
    //   viewType: 'axial'
    //   // TypeScript error: missing imageBitmap
    // });
  });
});