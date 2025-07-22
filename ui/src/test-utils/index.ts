/**
 * Central export point for all test utilities
 */

// Setup
export * from './setup/vitest-setup';

// Mocks
export {
	createMockEventBus,
	waitForEvent,
	assertEventSequence,
	assertEventEmitted
} from './mocks/mockEventBus';
export {
	mockService,
	createAsyncMockService,
	mockResolvedValue,
	mockRejectedValue,
	mockSequence,
	mockAsyncSequence
} from './mocks/mockService';
export { createMockDIContainer, setupMockServices, createTestContext } from './mocks/mockDI';
export {
	createMockStore,
	createMockSvelteStore,
	createMockLayerStore,
	createMockCrosshairStore,
	createMockVolumeStore,
	spyOnStore
} from './mocks/mockStores';
export { MockSliceViewerGPU, mockGpuRenderManager } from './mocks/mockSliceViewerGPU';

// Helpers
export {
	renderComponent,
	waitForUpdates,
	renderAndWait,
	waitFor,
	flushPromises
} from './helpers/render';

// Re-export commonly used testing library functions
export { cleanup, fireEvent, screen, within } from '@testing-library/svelte';
export { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
