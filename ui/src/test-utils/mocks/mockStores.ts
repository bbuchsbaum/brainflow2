/**
 * Mock Store Utilities
 * Provides test-friendly store implementations
 */
import { writable, readable, derived } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import { vi } from 'vitest';

/**
 * Creates a mock Zustand store for testing
 */
export function createMockStore<T extends Record<string, any>>(
	initialState: T
): {
	getState: () => T;
	setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
	subscribe: (listener: (state: T) => void) => () => void;
	destroy: () => void;
} {
	let state = { ...initialState };
	const listeners = new Set<(state: T) => void>();

	const getState = () => ({ ...state });

	const setState = (partial: Partial<T> | ((state: T) => Partial<T>)) => {
		const updates = typeof partial === 'function' ? partial(state) : partial;
		state = { ...state, ...updates };
		listeners.forEach((listener) => listener(state));
	};

	const subscribe = (listener: (state: T) => void) => {
		listeners.add(listener);
		listener(state); // Call immediately with current state
		return () => listeners.delete(listener);
	};

	const destroy = () => {
		listeners.clear();
	};

	return { getState, setState, subscribe, destroy };
}

/**
 * Creates a mock Svelte store for testing
 */
export function createMockSvelteStore<T>(initialValue: T): Writable<T> & {
	getSubscriberCount: () => number;
	getUpdateCount: () => number;
} {
	const { subscribe, set, update } = writable(initialValue);
	let subscriberCount = 0;
	let updateCount = 0;

	const mockSubscribe = vi.fn((run: (value: T) => void) => {
		subscriberCount++;
		const unsubscribe = subscribe(run);
		return () => {
			subscriberCount--;
			unsubscribe();
		};
	});

	const mockSet = vi.fn((value: T) => {
		updateCount++;
		set(value);
	});

	const mockUpdate = vi.fn((updater: (value: T) => T) => {
		updateCount++;
		update(updater);
	});

	return {
		subscribe: mockSubscribe,
		set: mockSet,
		update: mockUpdate,
		getSubscriberCount: () => subscriberCount,
		getUpdateCount: () => updateCount
	};
}

/**
 * Mock layer store for testing
 */
export function createMockLayerStore() {
	const layers = new Map();
	const store = createMockStore({
		layers,
		activeLayerId: null as string | null,

		addLayer: vi.fn((id: string, spec: any) => {
			layers.set(id, { id, spec });
			store.setState({ layers: new Map(layers) });
		}),

		updateLayer: vi.fn((id: string, updates: any) => {
			const layer = layers.get(id);
			if (layer) {
				layers.set(id, { ...layer, ...updates });
				store.setState({ layers: new Map(layers) });
			}
		}),

		removeLayer: vi.fn((id: string) => {
			layers.delete(id);
			store.setState({ layers: new Map(layers) });
		}),

		setActiveLayer: vi.fn((id: string | null) => {
			store.setState({ activeLayerId: id });
		}),

		getLayer: vi.fn((id: string) => layers.get(id)),

		getLayersByVolumeId: vi.fn((volumeId: string) => {
			const result = [];
			for (const layer of layers.values()) {
				if (layer.spec?.Volume?.source_resource_id === volumeId) {
					result.push(layer);
				}
			}
			return result;
		})
	});

	return store;
}

/**
 * Mock crosshair store for testing
 */
export function createMockCrosshairStore() {
	return createMockStore({
		worldCoord: [0, 0, 0] as [number, number, number],
		voxelCoord: null as [number, number, number] | null,
		visible: true,

		setWorldCoord: vi.fn((coord: [number, number, number]) => {
			store.setState({ worldCoord: coord });
		}),

		setVoxelCoord: vi.fn((coord: [number, number, number] | null) => {
			store.setState({ voxelCoord: coord });
		}),

		setVisible: vi.fn((visible: boolean) => {
			store.setState({ visible });
		}),

		reset: vi.fn(() => {
			store.setState({
				worldCoord: [0, 0, 0],
				voxelCoord: null,
				visible: true
			});
		})
	});

	const store = createMockStore({
		worldCoord: [0, 0, 0] as [number, number, number],
		voxelCoord: null as [number, number, number] | null,
		visible: true,
		setWorldCoord: () => {},
		setVoxelCoord: () => {},
		setVisible: () => {},
		reset: () => {}
	});

	return store;
}

/**
 * Mock volume store for testing
 * Matches the new Svelte store API
 */
export function createMockVolumeStore() {
	const volumes = new Map();
	const loadingVolumes = new Set();
	const errors = new Map();
	let activeVolumeId: string | null = null;

	const store = createMockSvelteStore({
		volumes,
		activeVolumeId,
		loadingVolumes,
		errors
	});

	// Add methods to match the real store API
	const mockStore = {
		...store,
		
		addVolume: vi.fn((metadata: any) => {
			volumes.set(metadata.id, metadata);
			if (!activeVolumeId) {
				activeVolumeId = metadata.id;
			}
			store.set({ volumes: new Map(volumes), activeVolumeId, loadingVolumes, errors });
		}),

		removeVolume: vi.fn((volumeId: string) => {
			volumes.delete(volumeId);
			errors.delete(volumeId);
			if (activeVolumeId === volumeId) {
				activeVolumeId = null;
			}
			store.set({ volumes: new Map(volumes), activeVolumeId, loadingVolumes, errors });
		}),

		setActiveVolume: vi.fn((volumeId: string | null) => {
			activeVolumeId = volumeId;
			store.set({ volumes, activeVolumeId, loadingVolumes, errors });
		}),

		setLoading: vi.fn((path: string, loading: boolean) => {
			if (loading) {
				loadingVolumes.add(path);
			} else {
				loadingVolumes.delete(path);
			}
			store.set({ volumes, activeVolumeId, loadingVolumes: new Set(loadingVolumes), errors });
		}),

		setError: vi.fn((volumeId: string, error: Error | null) => {
			if (error) {
				errors.set(volumeId, error);
			} else {
				errors.delete(volumeId);
			}
			store.set({ volumes, activeVolumeId, loadingVolumes, errors: new Map(errors) });
		}),

		clearError: vi.fn((volumeId: string) => {
			errors.delete(volumeId);
			store.set({ volumes, activeVolumeId, loadingVolumes, errors: new Map(errors) });
		}),

		clearAllErrors: vi.fn(() => {
			errors.clear();
			store.set({ volumes, activeVolumeId, loadingVolumes, errors: new Map() });
		}),

		getVolume: vi.fn((volumeId: string) => volumes.get(volumeId)),
		getActiveVolume: vi.fn(() => activeVolumeId ? volumes.get(activeVolumeId) : undefined),
		isLoading: vi.fn((path: string) => loadingVolumes.has(path)),
		hasError: vi.fn((volumeId: string) => errors.has(volumeId)),
		
		getState: vi.fn(() => ({ volumes, activeVolumeId, loadingVolumes, errors }))
	};

	return mockStore;
}

/**
 * Helper to create a store with spy methods
 */
export function spyOnStore<T extends Record<string, any>>(
	store: T
): T & { __resetSpies: () => void } {
	const spies: Record<string, any> = {};

	// Spy on all methods
	Object.keys(store).forEach((key) => {
		const value = store[key];
		if (typeof value === 'function') {
			spies[key] = vi.spyOn(store, key as keyof T);
		}
	});

	return {
		...store,
		__resetSpies: () => {
			Object.values(spies).forEach((spy) => {
				spy.mockRestore();
			});
		}
	};
}
