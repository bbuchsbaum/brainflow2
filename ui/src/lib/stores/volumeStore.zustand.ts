/**
 * Clean Volume Store - Pure state management without business logic
 * Uses VolumeService for all volume operations
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { VolumeMetadata } from '$lib/services/VolumeService';

export interface VolumeStoreState {
	// State
	volumes: Map<string, VolumeMetadata>;
	activeVolumeId: string | null;
	loadingVolumes: Set<string>;
	errors: Map<string, Error>;

	// Pure state mutations
	addVolume: (metadata: VolumeMetadata) => void;
	removeVolume: (volumeId: string) => void;
	setActiveVolume: (volumeId: string | null) => void;
	setLoading: (path: string, loading: boolean) => void;
	setError: (volumeId: string, error: Error | null) => void;
	clearError: (volumeId: string) => void;
	clearAllErrors: () => void;

	// Computed getters
	getVolume: (volumeId: string) => VolumeMetadata | undefined;
	getActiveVolume: () => VolumeMetadata | undefined;
	isLoading: (path: string) => boolean;
	hasError: (volumeId: string) => boolean;
}

/**
 * Create clean volume store
 * All business logic is handled by VolumeService
 */
export const useVolumeStore = create<VolumeStoreState>()(
	subscribeWithSelector((set, get) => ({
		// Initial state
		volumes: new Map(),
		activeVolumeId: null,
		loadingVolumes: new Set(),
		errors: new Map(),

		// Pure state mutations
		addVolume: (metadata) =>
			set((state) => {
				const volumes = new Map(state.volumes);
				volumes.set(metadata.id, metadata);
				return {
					volumes,
					// Auto-set as active if it's the first volume
					activeVolumeId: state.activeVolumeId || metadata.id
				};
			}),

		removeVolume: (volumeId) =>
			set((state) => {
				const volumes = new Map(state.volumes);
				volumes.delete(volumeId);

				const errors = new Map(state.errors);
				errors.delete(volumeId);

				return {
					volumes,
					errors,
					// Clear active if it was removed
					activeVolumeId: state.activeVolumeId === volumeId ? null : state.activeVolumeId
				};
			}),

		setActiveVolume: (volumeId) => set({ activeVolumeId: volumeId }),

		setLoading: (path, loading) =>
			set((state) => {
				const loadingVolumes = new Set(state.loadingVolumes);
				if (loading) {
					loadingVolumes.add(path);
				} else {
					loadingVolumes.delete(path);
				}
				return { loadingVolumes };
			}),

		setError: (volumeId, error) =>
			set((state) => {
				const errors = new Map(state.errors);
				if (error) {
					errors.set(volumeId, error);
				} else {
					errors.delete(volumeId);
				}
				return { errors };
			}),

		clearError: (volumeId) =>
			set((state) => {
				const errors = new Map(state.errors);
				errors.delete(volumeId);
				return { errors };
			}),

		clearAllErrors: () => set({ errors: new Map() }),

		// Computed getters
		getVolume: (volumeId) => {
			return get().volumes.get(volumeId);
		},

		getActiveVolume: () => {
			const state = get();
			return state.activeVolumeId ? state.volumes.get(state.activeVolumeId) : undefined;
		},

		isLoading: (path) => {
			return get().loadingVolumes.has(path);
		},

		hasError: (volumeId) => {
			return get().errors.has(volumeId);
		}
	}))
);

// Selectors for common use cases
export const volumeStoreSelectors = {
	allVolumes: (state: VolumeStoreState) => Array.from(state.volumes.values()),
	volumeCount: (state: VolumeStoreState) => state.volumes.size,
	hasVolumes: (state: VolumeStoreState) => state.volumes.size > 0,
	isAnyLoading: (state: VolumeStoreState) => state.loadingVolumes.size > 0,
	errorCount: (state: VolumeStoreState) => state.errors.size,

	// Get volume IDs in load order
	volumeIds: (state: VolumeStoreState) => {
		return Array.from(state.volumes.values())
			.sort((a, b) => a.loadedAt - b.loadedAt)
			.map((v) => v.id);
	},

	// Get recent volumes
	recentVolumes:
		(limit = 5) =>
		(state: VolumeStoreState) => {
			return Array.from(state.volumes.values())
				.sort((a, b) => b.loadedAt - a.loadedAt)
				.slice(0, limit);
		}
};
