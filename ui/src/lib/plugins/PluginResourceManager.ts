/**
 * Plugin Resource Manager
 * Manages memory allocation, resource limits, and cleanup for plugins
 */

import type {
	PluginResourceManager as IPluginResourceManager,
	MemoryBlock,
	MemoryUsage,
	ResourceLimitStatus,
	ResourceRequirements
} from './types';

export class PluginResourceManager {
	private allocatedMemory = new Map<string, MemoryBlock>();
	private pluginMemoryUsage = new Map<string, number>();
	private pluginLimits = new Map<string, ResourceRequirements>();
	private executionTimeouts = new Map<string, number>();
	private defaultLimits: ResourceRequirements;
	private totalAllocatedMemory = 0;
	private nextBlockId = 1;
	private isShuttingDown = false;

	// Global limits
	private readonly MAX_TOTAL_MEMORY = 512 * 1024 * 1024; // 512MB
	private readonly MAX_PLUGIN_MEMORY = 128 * 1024 * 1024; // 128MB per plugin
	private readonly DEFAULT_EXECUTION_TIMEOUT = 30000; // 30 seconds

	constructor(defaultLimits: ResourceRequirements) {
		this.defaultLimits = defaultLimits;
	}

	/**
	 * Create a plugin-specific interface
	 */
	createPluginInterface(pluginId: string): IPluginResourceManager {
		return new PluginResourceInterface(this, pluginId);
	}

	/**
	 * Set resource limits for a specific plugin
	 */
	setPluginLimits(pluginId: string, limits: ResourceRequirements): void {
		this.pluginLimits.set(pluginId, limits);
	}

	/**
	 * Get resource limits for a plugin
	 */
	getPluginLimits(pluginId: string): ResourceRequirements {
		return this.pluginLimits.get(pluginId) || this.defaultLimits;
	}

	/**
	 * Allocate memory for a plugin
	 */
	allocateMemory(size: number, pluginId: string): MemoryBlock | null {
		if (this.isShuttingDown) {
			console.warn('Resource manager is shutting down, cannot allocate memory');
			return null;
		}

		if (size <= 0 || size > this.MAX_PLUGIN_MEMORY) {
			console.error(`Invalid memory allocation size: ${size}`);
			return null;
		}

		// Check global memory limit
		if (this.totalAllocatedMemory + size > this.MAX_TOTAL_MEMORY) {
			console.error('Global memory limit exceeded');
			return null;
		}

		// Check plugin-specific memory limit
		const currentPluginUsage = this.pluginMemoryUsage.get(pluginId) || 0;
		const pluginLimits = this.getPluginLimits(pluginId);
		const pluginLimit = Math.min(pluginLimits.maxMemoryMB * 1024 * 1024, this.MAX_PLUGIN_MEMORY);

		if (currentPluginUsage + size > pluginLimit) {
			console.error(`Plugin ${pluginId} memory limit exceeded`);
			return null;
		}

		try {
			// Allocate the memory
			const buffer = new ArrayBuffer(size);
			const block: MemoryBlock = {
				id: `${pluginId}-${this.nextBlockId++}`,
				size,
				buffer,
				allocated: new Date()
			};

			// Track allocations
			this.allocatedMemory.set(block.id, block);
			this.pluginMemoryUsage.set(pluginId, currentPluginUsage + size);
			this.totalAllocatedMemory += size;

			return block;
		} catch (error) {
			console.error(`Failed to allocate memory for plugin ${pluginId}:`, error);
			return null;
		}
	}

	/**
	 * Release memory block
	 */
	releaseMemory(block: MemoryBlock): void {
		const trackedBlock = this.allocatedMemory.get(block.id);
		if (!trackedBlock) {
			console.warn(`Attempted to release unknown memory block: ${block.id}`);
			return;
		}

		// Extract plugin ID from block ID
		const pluginId = block.id.split('-')[0];
		const currentUsage = this.pluginMemoryUsage.get(pluginId) || 0;

		// Update tracking
		this.allocatedMemory.delete(block.id);
		this.pluginMemoryUsage.set(pluginId, Math.max(0, currentUsage - block.size));
		this.totalAllocatedMemory = Math.max(0, this.totalAllocatedMemory - block.size);

		// Clear the buffer (security measure)
		if (block.buffer) {
			try {
				new Uint8Array(block.buffer).fill(0);
			} catch (error) {
				// Ignore errors when clearing buffer
			}
		}
	}

	/**
	 * Get memory usage for a plugin
	 */
	getMemoryUsage(pluginId: string): MemoryUsage {
		const limits = this.getPluginLimits(pluginId);
		const allocated = this.pluginMemoryUsage.get(pluginId) || 0;
		const limit = Math.min(limits.maxMemoryMB * 1024 * 1024, this.MAX_PLUGIN_MEMORY);

		return {
			allocated,
			used: allocated, // For now, allocated = used
			limit
		};
	}

	/**
	 * Set execution timeout for a plugin
	 */
	setExecutionTimeout(pluginId: string, timeoutMs: number): void {
		this.executionTimeouts.set(pluginId, Math.min(timeoutMs, this.DEFAULT_EXECUTION_TIMEOUT));
	}

	/**
	 * Get execution timeout for a plugin
	 */
	getExecutionTimeout(pluginId: string): number {
		return this.executionTimeouts.get(pluginId) || this.DEFAULT_EXECUTION_TIMEOUT;
	}

	/**
	 * Check if plugin is within resource limits
	 */
	checkResourceLimits(pluginId: string): ResourceLimitStatus {
		const usage = this.getMemoryUsage(pluginId);
		const memoryOk = usage.used <= usage.limit;

		// For execution time, we need to check during actual execution
		const executionTimeOk = true; // This would be checked by execution wrapper

		return {
			memoryOk,
			executionTimeOk,
			withinLimits: memoryOk && executionTimeOk
		};
	}

	/**
	 * Release all resources for a plugin
	 */
	releaseAllResources(pluginId: string): void {
		// Find all memory blocks for this plugin
		const pluginBlocks = Array.from(this.allocatedMemory.values()).filter((block) =>
			block.id.startsWith(`${pluginId}-`)
		);

		// Release each block
		for (const block of pluginBlocks) {
			this.releaseMemory(block);
		}

		// Clear tracking
		this.pluginMemoryUsage.delete(pluginId);
		this.executionTimeouts.delete(pluginId);
		this.pluginLimits.delete(pluginId);
	}

	/**
	 * Get global resource statistics
	 */
	getGlobalStats(): {
		totalMemoryUsed: number;
		totalMemoryLimit: number;
		activePlugins: number;
		totalBlocks: number;
	} {
		return {
			totalMemoryUsed: this.totalAllocatedMemory,
			totalMemoryLimit: this.MAX_TOTAL_MEMORY,
			activePlugins: this.pluginMemoryUsage.size,
			totalBlocks: this.allocatedMemory.size
		};
	}

	/**
	 * Force garbage collection for a plugin (if possible)
	 */
	forceGarbageCollection(pluginId: string): void {
		// In a browser environment, we can't force GC
		// This is a placeholder for potential future implementation
		if (typeof global !== 'undefined' && global.gc) {
			try {
				global.gc();
			} catch (error) {
				// Ignore GC errors
			}
		}
	}

	/**
	 * Get memory leaks detection
	 */
	detectMemoryLeaks(pluginId: string): {
		potentialLeaks: MemoryBlock[];
		oldestBlock: MemoryBlock | null;
	} {
		const pluginBlocks = Array.from(this.allocatedMemory.values()).filter((block) =>
			block.id.startsWith(`${pluginId}-`)
		);

		const now = Date.now();
		const oneHour = 60 * 60 * 1000;

		// Blocks older than 1 hour might be leaks
		const potentialLeaks = pluginBlocks.filter(
			(block) => now - block.allocated.getTime() > oneHour
		);

		const oldestBlock = pluginBlocks.reduce(
			(oldest, current) => (!oldest || current.allocated < oldest.allocated ? current : oldest),
			null as MemoryBlock | null
		);

		return { potentialLeaks, oldestBlock };
	}

	/**
	 * Shutdown the resource manager
	 */
	shutdown(): void {
		this.isShuttingDown = true;

		// Release all memory blocks
		for (const block of this.allocatedMemory.values()) {
			try {
				this.releaseMemory(block);
			} catch (error) {
				console.error('Error releasing memory block during shutdown:', error);
			}
		}

		// Clear all tracking
		this.allocatedMemory.clear();
		this.pluginMemoryUsage.clear();
		this.pluginLimits.clear();
		this.executionTimeouts.clear();
	}
}

/**
 * Plugin-specific resource manager interface
 */
class PluginResourceInterface implements IPluginResourceManager {
	constructor(
		private resourceManager: PluginResourceManager,
		private pluginId: string
	) {}

	allocateMemory(size: number): MemoryBlock | null {
		return this.resourceManager.allocateMemory(size, this.pluginId);
	}

	releaseMemory(block: MemoryBlock): void {
		this.resourceManager.releaseMemory(block);
	}

	getMemoryUsage(): MemoryUsage {
		return this.resourceManager.getMemoryUsage(this.pluginId);
	}

	setExecutionTimeout(timeoutMs: number): void {
		this.resourceManager.setExecutionTimeout(this.pluginId, timeoutMs);
	}

	checkResourceLimits(): ResourceLimitStatus {
		return this.resourceManager.checkResourceLimits(this.pluginId);
	}
}

/**
 * Memory pool for efficient allocation/deallocation
 */
export class MemoryPool {
	private pools = new Map<number, ArrayBuffer[]>();
	private readonly POOL_SIZES = [1024, 4096, 16384, 65536, 262144, 1048576]; // 1KB to 1MB

	/**
	 * Get a buffer from the pool or create a new one
	 */
	getBuffer(size: number): ArrayBuffer {
		const poolSize = this.findPoolSize(size);
		let pool = this.pools.get(poolSize);

		if (!pool) {
			pool = [];
			this.pools.set(poolSize, pool);
		}

		if (pool.length > 0) {
			return pool.pop()!;
		}

		return new ArrayBuffer(poolSize);
	}

	/**
	 * Return a buffer to the pool
	 */
	returnBuffer(buffer: ArrayBuffer): void {
		const size = buffer.byteLength;
		const poolSize = this.findPoolSize(size);

		if (poolSize === size) {
			let pool = this.pools.get(poolSize);
			if (!pool) {
				pool = [];
				this.pools.set(poolSize, pool);
			}

			// Clear the buffer before returning to pool
			new Uint8Array(buffer).fill(0);

			// Limit pool size to prevent memory bloat
			if (pool.length < 10) {
				pool.push(buffer);
			}
		}
	}

	/**
	 * Clear all pools
	 */
	clear(): void {
		this.pools.clear();
	}

	private findPoolSize(size: number): number {
		for (const poolSize of this.POOL_SIZES) {
			if (size <= poolSize) {
				return poolSize;
			}
		}
		return size; // For sizes larger than our pools
	}
}
