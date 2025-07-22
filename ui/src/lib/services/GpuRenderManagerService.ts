/**
 * GpuRenderManagerService - Singleton service managing the shared GpuRenderManager instance
 * 
 * This service ensures all views share the same GpuRenderManager instance,
 * implementing the "1 volume = 1 layer" architecture where layers are shared
 * across all views (Axial, Coronal, Sagittal).
 */
import { GpuRenderManager } from '$lib/gpu/renderManager';
import type { EventBus } from '$lib/events/EventBus';

export interface GpuRenderManagerServiceConfig {
	eventBus: EventBus;
}

export class GpuRenderManagerService {
	private renderManager: GpuRenderManager | null = null;
	private initializationPromise: Promise<void> | null = null;
	private initialized = false;

	constructor(private config: GpuRenderManagerServiceConfig) {}

	/**
	 * Initialize the GPU render manager (idempotent)
	 */
	async initialize(): Promise<void> {
		// If already initialized, return immediately
		if (this.initialized && this.renderManager) {
			return;
		}

		// If initialization is in progress, wait for it
		if (this.initializationPromise) {
			await this.initializationPromise;
			return;
		}

		// Start initialization
		this.initializationPromise = this.doInitialize();
		
		try {
			await this.initializationPromise;
		} finally {
			this.initializationPromise = null;
		}
	}

	private async doInitialize(): Promise<void> {
		try {
			console.log('[GpuRenderManagerService] Initializing GPU render manager...');
			
			// Create the render manager instance
			this.renderManager = new GpuRenderManager();
			
			// Initialize the render loop
			await this.renderManager.initialize();
			
			this.initialized = true;
			
			// Emit initialization event
			this.config.eventBus.emit('gpu.manager.initialized', {});
			
			console.log('[GpuRenderManagerService] GPU render manager initialized successfully');
		} catch (error) {
			console.error('[GpuRenderManagerService] Failed to initialize:', error);
			this.config.eventBus.emit('gpu.manager.error', { error });
			throw error;
		}
	}

	/**
	 * Get the shared GpuRenderManager instance
	 * @throws Error if not initialized
	 */
	getRenderManager(): GpuRenderManager {
		if (!this.renderManager) {
			throw new Error('GpuRenderManagerService not initialized. Call initialize() first.');
		}
		return this.renderManager;
	}

	/**
	 * Check if the service is initialized
	 */
	isInitialized(): boolean {
		return this.initialized && this.renderManager !== null;
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		if (this.renderManager) {
			await this.renderManager.clearLayers();
			this.renderManager = null;
			this.initialized = false;
			this.config.eventBus.emit('gpu.manager.cleanup', {});
		}
	}
}

/**
 * Factory function to create GpuRenderManagerService
 */
export function createGpuRenderManagerService(config: GpuRenderManagerServiceConfig): GpuRenderManagerService {
	return new GpuRenderManagerService(config);
}