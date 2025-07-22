/**
 * Resilient Volume Service with retry logic and fallback strategies
 * Extends the base VolumeService with automatic error recovery
 */

import { VolumeService } from './VolumeService';
import { ResilientService } from './ResilientService';
import type { EventBus } from '$lib/events/EventBus';
import type { ValidationService } from '$lib/validation/ValidationService';
import type { Api } from '@brainflow/api';
import type { GpuResourceManager } from '$lib/gpu/GpuResourceManager';
import type { NotificationService } from './NotificationService';
import type {
	VolumeSpec,
	VolumeHandle,
	SliceData,
	VoxelCoordinates,
	WorldCoordinates
} from '@brainflow/api';

export interface ResilientVolumeServiceConfig {
	eventBus: EventBus;
	validator: ValidationService;
	api: Api;
	gpuManager: GpuResourceManager;
	notificationService?: NotificationService;
	enableOfflineMode?: boolean;
	enableCaching?: boolean;
	maxCacheSize?: number;
}

/**
 * Volume service with resilience features
 */
export class ResilientVolumeService extends VolumeService {
	private resilientBase: ResilientService;
	private offlineMode: boolean;
	private offlineCache = new Map<string, VolumeHandle>();
	private sliceFailureCache = new Map<string, number>();
	private eventBus: EventBus;

	constructor(config: ResilientVolumeServiceConfig) {
		super({
			eventBus: config.eventBus,
			validator: config.validator,
			api: config.api,
			gpuManager: config.gpuManager
		});

		// Store eventBus reference
		this.eventBus = config.eventBus;

		// Initialize resilient base
		this.resilientBase = new ResilientService({
			serviceName: 'VolumeService',
			eventBus: config.eventBus,
			notificationService: config.notificationService,
			enableCircuitBreaker: true,
			circuitBreakerThreshold: 3,
			circuitBreakerResetTime: 30000, // 30 seconds
			defaultRetryConfig: {
				maxRetries: 3,
				baseDelay: 1000,
				shouldRetry: this.shouldRetryVolumeOperation.bind(this)
			}
		});

		this.offlineMode = config.enableOfflineMode ?? false;

		// Subscribe to network status
		if (this.offlineMode) {
			this.setupOfflineHandling();
		}
	}

	/**
	 * Load volume with automatic retry
	 */
	async load(path: string): Promise<string> {
		try {
			return await (this.resilientBase as any).withRetry(() => super.load(path), 'load-volume', {
				maxRetries: 3,
				onRetry: (error, attempt) => {
					this.notificationService?.info(`Retrying volume load (attempt ${attempt}/3)...`, {
						duration: 3000
					});
				}
			});
		} catch (error) {
			// Try offline cache if available
			if (this.offlineMode && this.offlineCache.has(path)) {
				this.notificationService?.warning('Loading volume from offline cache', { duration: 5000 });

				const cached = this.offlineCache.get(path)!;
				this.volumes.set(cached.volumeId, cached);
				this.eventBus.emit('volume.loaded', { volumeId: cached.volumeId, path });
				return cached.volumeId;
			}

			throw error;
		}
	}

	/**
	 * Get slice data with retry and caching
	 */
	async getSliceData(
		volumeId: string,
		axis: 'axial' | 'sagittal' | 'coronal',
		index: number
	): Promise<SliceData> {
		const cacheKey = `${volumeId}-${axis}-${index}`;

		try {
			const data = await (this.resilientBase as any).withRetry(
				() => super.getSliceData(volumeId, axis, index),
				'get-slice-data',
				{
					maxRetries: 2,
					baseDelay: 500
				}
			);

			// Reset failure count on success
			this.sliceFailureCache.delete(cacheKey);

			return data;
		} catch (error) {
			// Track failures
			const failures = (this.sliceFailureCache.get(cacheKey) || 0) + 1;
			this.sliceFailureCache.set(cacheKey, failures);

			// Return placeholder data if too many failures
			if (failures > 3) {
				this.notificationService?.warning(
					`Unable to load slice ${axis}:${index}, showing placeholder`,
					{ duration: 3000 }
				);

				return this.getPlaceholderSliceData(volumeId, axis, index);
			}

			throw error;
		}
	}

	/**
	 * Batch load multiple volumes with partial failure handling
	 */
	async batchLoad(paths: string[]): Promise<{
		loaded: string[];
		failed: Array<{ path: string; error: Error }>;
	}> {
		const loaded: string[] = [];
		const failed: Array<{ path: string; error: Error }> = [];

		// Use Promise.allSettled for partial failure handling
		const results = await Promise.allSettled(paths.map((path) => this.load(path)));

		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				loaded.push(result.value);
			} else {
				failed.push({
					path: paths[index],
					error: result.reason
				});
			}
		});

		// Notify about partial failures
		if (failed.length > 0 && loaded.length > 0) {
			this.notificationService?.warning(
				`Loaded ${loaded.length} volumes, ${failed.length} failed`,
				{ duration: 5000 }
			);
		}

		return { loaded, failed };
	}

	/**
	 * Convert coordinates with fallback on failure
	 */
	async worldToVoxel(volumeId: string, world: WorldCoordinates): Promise<VoxelCoordinates | null> {
		try {
			return await (this.resilientBase as any).withRetry(
				() => super.worldToVoxel(volumeId, world),
				'world-to-voxel',
				{
					maxRetries: 1,
					baseDelay: 100
				}
			);
		} catch (error) {
			// Return approximate conversion based on volume metadata
			const volume = this.volumes.get(volumeId);
			if (volume) {
				// Simple fallback conversion
				return this.approximateWorldToVoxel(volume, world);
			}
			return null;
		}
	}

	/**
	 * Custom retry logic for volume operations
	 */
	private shouldRetryVolumeOperation(error: Error, attempt: number): boolean {
		// Don't retry validation errors
		if (error.name === 'ValidationError') {
			return false;
		}

		// Don't retry file not found
		if (error.message.includes('not found') || error.message.includes('does not exist')) {
			return false;
		}

		// Don't retry permission errors
		if (error.message.includes('permission') || error.message.includes('access denied')) {
			return false;
		}

		// Retry network and timeout errors
		return ['NetworkError', 'TimeoutError', 'FetchError'].includes(error.name);
	}

	/**
	 * Setup offline mode handling
	 */
	private setupOfflineHandling(): void {
		// Listen for successful loads to cache
		this.eventBus.on('volume.loaded', ({ volumeId }) => {
			const volume = this.volumes.get(volumeId);
			if (volume && volume.metadata?.sourcePath) {
				this.offlineCache.set(volume.metadata.sourcePath, volume);

				// Limit cache size
				if (this.offlineCache.size > 10) {
					const firstKey = this.offlineCache.keys().next().value;
					this.offlineCache.delete(firstKey);
				}
			}
		});

		// Listen for network status
		window.addEventListener('online', () => {
			this.notificationService?.success('Connection restored', { duration: 3000 });
			this.resilientBase.resetCircuitBreaker();
		});

		window.addEventListener('offline', () => {
			this.notificationService?.warning('Working offline - some features may be limited', {
				duration: 10000
			});
		});
	}

	/**
	 * Get placeholder slice data for failed loads
	 */
	private getPlaceholderSliceData(
		volumeId: string,
		axis: 'axial' | 'sagittal' | 'coronal',
		index: number
	): SliceData {
		const volume = this.volumes.get(volumeId);
		if (!volume) {
			throw new Error('Volume not found');
		}

		// Return checkerboard pattern as placeholder
		const size =
			axis === 'axial'
				? [volume.dimensions[0], volume.dimensions[1]]
				: axis === 'sagittal'
					? [volume.dimensions[1], volume.dimensions[2]]
					: [volume.dimensions[0], volume.dimensions[2]];

		const data = new Float32Array(size[0] * size[1]);

		// Create checkerboard
		for (let y = 0; y < size[1]; y++) {
			for (let x = 0; x < size[0]; x++) {
				const i = y * size[0] + x;
				data[i] = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0.3 : 0.7;
			}
		}

		return {
			data,
			width: size[0],
			height: size[1],
			sliceIndex: index,
			axis,
			worldMatrix: new Float32Array(16) // Identity matrix
		};
	}

	/**
	 * Approximate world to voxel conversion
	 */
	private approximateWorldToVoxel(volume: VolumeHandle, world: WorldCoordinates): VoxelCoordinates {
		// Simple approximation using voxel size
		const voxelSize = volume.voxelSize || [1, 1, 1];

		return [
			Math.round(world[0] / voxelSize[0]),
			Math.round(world[1] / voxelSize[1]),
			Math.round(world[2] / voxelSize[2])
		];
	}

	/**
	 * Get service health including resilience metrics
	 */
	getHealthStatus() {
		return {
			...super.getHealthStatus(),
			resilience: this.resilientBase.getHealthStatus(),
			offlineMode: this.offlineMode,
			offlineCacheSize: this.offlineCache.size,
			sliceFailures: this.sliceFailureCache.size
		};
	}
}

/**
 * Factory function to create resilient volume service
 */
export function createResilientVolumeService(
	config: ResilientVolumeServiceConfig
): ResilientVolumeService {
	return new ResilientVolumeService(config);
}
