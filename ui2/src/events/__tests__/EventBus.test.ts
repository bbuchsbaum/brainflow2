/**
 * EventBus Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('basic functionality', () => {
    it('should emit and receive events', () => {
      const handler = vi.fn();
      eventBus.on('crosshair.updated', handler);

      const data = { world_mm: [10, 20, 30] as [number, number, number] };
      eventBus.emit('crosshair.updated', data);

      expect(handler).toHaveBeenCalledWith(data);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      eventBus.on('layer.added', handler1);
      eventBus.on('layer.added', handler2);

      const layer = { 
        id: 'layer1', 
        name: 'Test Layer',
        volumeId: 'vol1',
        type: 'anatomical' as const,
        visible: true,
        order: 0
      };
      
      eventBus.emit('layer.added', { layer });

      expect(handler1).toHaveBeenCalledWith({ layer });
      expect(handler2).toHaveBeenCalledWith({ layer });
    });

    it('should unsubscribe handlers', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('view.resized', handler);

      eventBus.emit('view.resized', { viewType: 'axial', size: [256, 256] });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      
      eventBus.emit('view.resized', { viewType: 'sagittal', size: [256, 256] });
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe('once functionality', () => {
    it('should only trigger once', () => {
      const handler = vi.fn();
      eventBus.once('file.loaded', handler);

      eventBus.emit('file.loaded', { path: '/test.nii', volumeId: 'vol1' });
      eventBus.emit('file.loaded', { path: '/test2.nii', volumeId: 'vol2' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ path: '/test.nii', volumeId: 'vol1' });
    });
  });

  describe('wildcard handlers', () => {
    it('should receive all events', () => {
      const wildcardHandler = vi.fn();
      eventBus.onAny(wildcardHandler);

      eventBus.emit('crosshair.updated', { world_mm: [1, 2, 3] as [number, number, number] });
      eventBus.emit('layer.visibility', { layerId: 'layer1', visible: false });

      expect(wildcardHandler).toHaveBeenCalledTimes(2);
      expect(wildcardHandler).toHaveBeenNthCalledWith(1, 'crosshair.updated', { world_mm: [1, 2, 3] });
      expect(wildcardHandler).toHaveBeenNthCalledWith(2, 'layer.visibility', { layerId: 'layer1', visible: false });
    });

    it('should unsubscribe wildcard handlers', () => {
      const wildcardHandler = vi.fn();
      const unsubscribe = eventBus.onAny(wildcardHandler);

      eventBus.emit('ui.notification', { type: 'info', message: 'Test' });
      expect(wildcardHandler).toHaveBeenCalledTimes(1);

      unsubscribe();
      
      eventBus.emit('ui.notification', { type: 'error', message: 'Test 2' });
      expect(wildcardHandler).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('error handling', () => {
    it('should not crash when handler throws', () => {
      const goodHandler = vi.fn();
      const badHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      
      eventBus.on('annotation.added', badHandler);
      eventBus.on('annotation.added', goodHandler);

      const annotation = {
        id: 'ann1',
        type: 'marker' as const,
        world_mm: [0, 0, 0] as [number, number, number],
        visible: true,
        selected: false,
        symbol: 'circle' as const,
        size: 10
      };

      expect(() => {
        eventBus.emit('annotation.added', { annotation });
      }).not.toThrow();

      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('off functionality', () => {
    it('should remove a specific handler when provided', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('volume.loaded', handler1);
      eventBus.on('volume.loaded', handler2);

      eventBus.off('volume.loaded', handler1);

      eventBus.emit('volume.loaded', { volumeId: 'vol1', metadata: {} });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should remove all handlers for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      eventBus.on('volume.loaded', handler1);
      eventBus.on('volume.loaded', handler2);

      eventBus.off('volume.loaded');

      eventBus.emit('volume.loaded', { volumeId: 'vol1', metadata: {} });
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should clear all handlers when called without event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const wildcardHandler = vi.fn();
      
      eventBus.on('layer.added', handler1);
      eventBus.on('crosshair.clicked', handler2);
      eventBus.onAny(wildcardHandler);

      eventBus.off();

      eventBus.emit('layer.added', { layer: {} as any });
      eventBus.emit('crosshair.clicked', { world_mm: [0, 0, 0] as [number, number, number], button: 0 });
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(wildcardHandler).not.toHaveBeenCalled();
    });
  });

  describe('debug features', () => {
    it('should track handler counts', () => {
      eventBus.on('crosshair.updated', () => {});
      eventBus.on('crosshair.updated', () => {});
      eventBus.on('layer.added', () => {});
      eventBus.onAny(() => {});

      const counts = eventBus.getHandlerCounts();
      
      expect(counts['crosshair.updated']).toBe(2);
      expect(counts['layer.added']).toBe(1);
      expect(counts['*']).toBe(1);
    });
  });

  describe('performance', () => {
    it('should handle high-frequency events efficiently', () => {
      const handler = vi.fn();
      eventBus.on('crosshair.updated', handler);

      const startTime = performance.now();
      
      // Emit 10,000 events
      for (let i = 0; i < 10000; i++) {
        eventBus.emit('crosshair.updated', { world_mm: [i, i, i] as [number, number, number] });
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(handler).toHaveBeenCalledTimes(10000);
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });
});
