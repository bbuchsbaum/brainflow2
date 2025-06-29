/**
 * Service Test Utilities
 * Helper functions and mocks for testing services
 */

import { vi } from 'vitest';
import { EventBus } from '$lib/events/EventBus';
import { ValidationService } from '$lib/validation/ValidationService';
import type { DIContainer } from '$lib/di/Container';

/**
 * Create a mock EventBus for testing
 */
export function createMockEventBus(): EventBus {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, 'emit');
  const onSpy = vi.spyOn(eventBus, 'on');
  
  return Object.assign(eventBus, {
    emitSpy,
    onSpy,
    reset: () => {
      emitSpy.mockClear();
      onSpy.mockClear();
    }
  });
}

/**
 * Create a mock ValidationService
 */
export function createMockValidationService(): ValidationService {
  const validator = new ValidationService();
  const validateSpy = vi.spyOn(validator, 'validate').mockImplementation((schema, data) => data);
  
  return Object.assign(validator, {
    validateSpy,
    reset: () => validateSpy.mockClear()
  });
}

/**
 * Create a mock API
 */
export function createMockApi() {
  return {
    load_file: vi.fn().mockResolvedValue({
      Volume: {
        id: 'test-volume-id',
        shape: [256, 256, 128],
        voxel_size: [1, 1, 1],
        dtype: 'float32',
        origin: [0, 0, 0],
        spacing: [1, 1, 1]
      }
    }),
    request_layer_gpu_resources: vi.fn().mockResolvedValue({
      dim: [256, 256, 128],
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      texture_format: 'r32float',
      gpu_buffer_id: 'test-gpu-buffer'
    }),
    world_to_voxel: vi.fn().mockImplementation((id, coord) => coord),
    voxel_to_world: vi.fn().mockImplementation((id, coord) => coord),
    sample_world_coordinate: vi.fn().mockResolvedValue(127.5),
    get_slice: vi.fn().mockResolvedValue({
      data: new Float32Array(256 * 256),
      width: 256,
      height: 256
    }),
    ls_tree: vi.fn().mockResolvedValue({
      nodes: [
        { id: '/test/file1.nii', name: 'file1.nii', is_dir: false, size: 1024 },
        { id: '/test/dir1', name: 'dir1', is_dir: true }
      ]
    })
  };
}

/**
 * Create a test DI container
 */
export function createTestContainer(): DIContainer {
  const { DIContainer } = require('$lib/di/Container');
  const container = new DIContainer();
  
  // Register mock services
  container.registerValue('eventBus', createMockEventBus());
  container.registerValue('validator', createMockValidationService());
  container.registerValue('api', createMockApi());
  
  return container;
}

/**
 * Wait for event to be emitted
 */
export function waitForEvent(
  eventBus: EventBus,
  eventName: string,
  timeout = 1000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Event '${eventName}' not emitted within ${timeout}ms`));
    }, timeout);
    
    const unsubscribe = eventBus.on(eventName, (data) => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(data);
    });
  });
}

/**
 * Create a spy for store subscriptions
 */
export function createStoreSpy<T>(initialState: T) {
  const subscribers = new Set<(state: T) => void>();
  let state = initialState;
  
  return {
    getState: () => state,
    setState: (newState: T) => {
      state = newState;
      subscribers.forEach(sub => sub(state));
    },
    subscribe: vi.fn((selector: (state: T) => any, callback: (value: any) => void) => {
      const subscriber = (state: T) => callback(selector(state));
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }),
    reset: () => {
      subscribers.clear();
      state = initialState;
    }
  };
}

/**
 * Mock GPU Resource Manager
 */
export function createMockGpuResourceManager() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    acquireRenderTarget: vi.fn().mockReturnValue({
      texture: {},
      view: {},
      width: 512,
      height: 512
    }),
    releaseRenderTarget: vi.fn(),
    getTexture: vi.fn().mockReturnValue({}),
    releaseTexture: vi.fn(),
    releaseResourcesForVolume: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({
      totalMemory: 1024 * 1024 * 512, // 512MB
      usedMemory: 1024 * 1024 * 128,  // 128MB
      textureCount: 5,
      renderTargetCount: 2
    })
  };
}

/**
 * Test data generators
 */
export const testData = {
  volumeMetadata: (overrides = {}) => ({
    id: 'test-volume-1',
    path: '/test/volume.nii',
    name: 'test-volume',
    dimensions: [256, 256, 128] as [number, number, number],
    voxelSize: [1, 1, 1] as [number, number, number],
    dataType: 'float32',
    origin: [0, 0, 0] as [number, number, number],
    spacing: [1, 1, 1] as [number, number, number],
    loadedAt: Date.now(),
    ...overrides
  }),
  
  layerSpec: (overrides = {}) => ({
    type: 'Volume' as const,
    Volume: {
      id: 'test-layer-1',
      source_resource_id: 'test-volume-1',
      colormap: 'grayscale' as const,
      slice_axis: null,
      slice_index: null,
      ...overrides
    }
  }),
  
  mountConfig: (overrides = {}) => ({
    id: 'test-mount-1',
    path: '/test/data',
    label: 'Test Data',
    filePatterns: ['.nii', '.nii.gz'],
    ...overrides
  })
};

/**
 * Assert event was emitted with expected data
 */
export function assertEventEmitted(
  eventBus: any,
  eventName: string,
  expectedData?: any
) {
  expect(eventBus.emitSpy).toHaveBeenCalledWith(
    eventName,
    expectedData ? expect.objectContaining(expectedData) : expect.anything()
  );
}

/**
 * Assert event was not emitted
 */
export function assertEventNotEmitted(eventBus: any, eventName: string) {
  const calls = eventBus.emitSpy.mock.calls;
  const eventCalls = calls.filter(([name]) => name === eventName);
  expect(eventCalls).toHaveLength(0);
}