import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayerStore } from '@/stores/layerStore';
import type { Layer } from '@/types/layers';

// Mock the LayerService
vi.mock('@/services/LayerService', () => ({
  LayerService: {
    getInstance: vi.fn(() => ({
      patchLayer: vi.fn()
    }))
  }
}));

// Mock the event bus to prevent logging during tests
vi.mock('@/events/EventBus', () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }))
}));

describe('LayerPanel', () => {
  beforeEach(() => {
    // Reset store state
    const { clearLayers } = useLayerStore.getState();
    clearLayers();
  });

  it('should handle empty state', () => {
    const state = useLayerStore.getState();
    expect(state.layers).toHaveLength(0);
    expect(state.selectedLayerId).toBeNull();
  });

  it('should add and manage layers', () => {
    const { addLayer, selectLayer } = useLayerStore.getState();
    
    const testLayer: Layer = {
      id: 'test-layer-1',
      name: 'Test Volume',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    addLayer(testLayer);
    const state1 = useLayerStore.getState();
    expect(state1.layers).toHaveLength(1);
    expect(state1.layers[0]).toEqual(testLayer);

    selectLayer('test-layer-1');
    const state2 = useLayerStore.getState();
    expect(state2.selectedLayerId).toBe('test-layer-1');
  });

  it('should handle layer reordering', () => {
    const { addLayer, reorderLayers } = useLayerStore.getState();
    
    const layer1: Layer = {
      id: 'layer-1',
      name: 'Layer 1',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    const layer2: Layer = {
      id: 'layer-2', 
      name: 'Layer 2',
      type: 'volume',
      visible: true,
      handle: 'handle-2'
    };

    addLayer(layer1);
    addLayer(layer2);

    let state = useLayerStore.getState();
    expect(state.layers.map(l => l.id)).toEqual(['layer-1', 'layer-2']);

    // Reorder layers
    reorderLayers([layer2, layer1]);
    state = useLayerStore.getState();
    expect(state.layers.map(l => l.id)).toEqual(['layer-2', 'layer-1']);
  });

  it('should handle layer duplication', () => {
    const { addLayer } = useLayerStore.getState();
    
    const originalLayer: Layer = {
      id: 'original',
      name: 'Original Layer',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    addLayer(originalLayer);

    // Simulate duplication
    const duplicatedLayer: Layer = {
      ...originalLayer,
      id: `${originalLayer.id}_copy_${Date.now()}`,
      name: `${originalLayer.name} (Copy)`
    };

    addLayer(duplicatedLayer);

    const state = useLayerStore.getState();
    expect(state.layers).toHaveLength(2);
    expect(state.layers[1].name).toBe('Original Layer (Copy)');
    expect(state.layers[1].id).toContain('_copy_');
  });

  it('should handle layer removal', () => {
    const { addLayer, removeLayer } = useLayerStore.getState();
    
    const testLayer: Layer = {
      id: 'test-layer',
      name: 'Test Layer',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    addLayer(testLayer);
    let state = useLayerStore.getState();
    expect(state.layers).toHaveLength(1);

    removeLayer('test-layer');
    state = useLayerStore.getState();
    expect(state.layers).toHaveLength(0);
  });

  it('should clear all layers', () => {
    const { addLayer, clearLayers } = useLayerStore.getState();
    
    // Add multiple layers
    addLayer({
      id: 'layer-1',
      name: 'Layer 1',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    });

    addLayer({
      id: 'layer-2',
      name: 'Layer 2', 
      type: 'volume',
      visible: true,
      handle: 'handle-2'
    });

    let state = useLayerStore.getState();
    expect(state.layers).toHaveLength(2);

    clearLayers();
    state = useLayerStore.getState();
    expect(state.layers).toHaveLength(0);
    expect(state.selectedLayerId).toBeNull();
  });

  it('should handle layer render properties', () => {
    const { addLayer, setLayerRender } = useLayerStore.getState();
    
    const testLayer: Layer = {
      id: 'test-layer',
      name: 'Test Layer',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    addLayer(testLayer);

    const renderProps = {
      opacity: 0.8,
      intensity: [10, 200] as [number, number],
      threshold: [50, 150] as [number, number],
      colormap: 'viridis',
      interpolation: 'linear' as const
    };

    setLayerRender('test-layer', renderProps);

    const state = useLayerStore.getState();
    const layerRender = state.layerRender.get('test-layer');
    expect(layerRender).toEqual(renderProps);
  });

  it('should handle loading and error states', () => {
    const { addLayer, setLayerLoading, setLayerError } = useLayerStore.getState();
    
    const testLayer: Layer = {
      id: 'test-layer',
      name: 'Test Layer',
      type: 'volume',
      visible: true,
      handle: 'handle-1'
    };

    addLayer(testLayer);

    // Test loading state
    setLayerLoading('test-layer', true);
    let state = useLayerStore.getState();
    expect(state.loadingLayers.has('test-layer')).toBe(true);

    setLayerLoading('test-layer', false);
    state = useLayerStore.getState();
    expect(state.loadingLayers.has('test-layer')).toBe(false);

    // Test error state
    const testError = new Error('Failed to load layer');
    setLayerError('test-layer', testError);
    state = useLayerStore.getState();
    expect(state.errorLayers.get('test-layer')).toBe(testError);

    // Clear error
    setLayerError('test-layer', null);
    state = useLayerStore.getState();
    expect(state.errorLayers.has('test-layer')).toBe(false);
  });
});