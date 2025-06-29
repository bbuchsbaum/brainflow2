/**
 * GpuResourceManager - Manages GPU resource pooling and lifecycle
 * Prevents memory fragmentation and improves performance
 */
import { coreApi } from '$lib/api';
import { LRUCache } from '$lib/utils/LRUCache';

export interface RenderTarget {
  id: string;
  width: number;
  height: number;
  actualWidth: number;
  actualHeight: number;
  lastUsed: number;
  refCount: number;
}

export interface TextureResource {
  id: string;
  volumeId: string;
  atlasIndex: number;
  refCount: number;
}

export class GpuResourceManager {
  private renderTargets = new Map<string, RenderTarget>();
  private textureCache = new LRUCache<string, TextureResource>(20); // Max 20 textures
  private initialized = false;
  
  // Pool configuration
  private readonly POOL_SIZE = 5;
  private readonly SIZE_BUCKETS = [256, 512, 1024, 2048];
  
  /**
   * Initialize GPU resources
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('[GpuResourceManager] Initializing...');
    await coreApi.init_render_loop();
    
    // Pre-allocate common render target sizes
    await this.preallocateRenderTargets();
    
    this.initialized = true;
    console.log('[GpuResourceManager] Initialized');
  }
  
  /**
   * Pre-allocate render targets for common sizes
   */
  private async preallocateRenderTargets(): Promise<void> {
    for (const size of this.SIZE_BUCKETS.slice(0, 2)) {
      // Pre-allocate 512x512 and 1024x1024
      const key = this.getRenderTargetKey(size, size);
      await this.createRenderTarget(key, size, size);
    }
  }
  
  /**
   * Acquire a render target of the specified size
   */
  async acquireRenderTarget(width: number, height: number): Promise<RenderTarget> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Round up to nearest bucket size for better reuse
    const bucketWidth = this.findBucketSize(width);
    const bucketHeight = this.findBucketSize(height);
    const key = this.getRenderTargetKey(bucketWidth, bucketHeight);
    
    let target = this.renderTargets.get(key);
    
    if (!target) {
      // Create new render target
      target = await this.createRenderTarget(key, bucketWidth, bucketHeight);
    }
    
    // Update usage
    target.refCount++;
    target.lastUsed = Date.now();
    
    return target;
  }
  
  /**
   * Release a render target
   */
  releaseRenderTarget(target: RenderTarget): void {
    target.refCount--;
    
    if (target.refCount <= 0) {
      // Don't immediately destroy - keep in pool for reuse
      target.refCount = 0;
      target.lastUsed = Date.now();
      
      // Clean up old unused targets if pool is full
      this.cleanupUnusedTargets();
    }
  }
  
  /**
   * Create a new render target
   */
  private async createRenderTarget(
    key: string, 
    width: number, 
    height: number
  ): Promise<RenderTarget> {
    console.log(`[GpuResourceManager] Creating render target ${width}x${height}`);
    
    await coreApi.create_offscreen_render_target(width, height);
    
    const target: RenderTarget = {
      id: key,
      width,
      height,
      actualWidth: width,
      actualHeight: height,
      lastUsed: Date.now(),
      refCount: 0
    };
    
    this.renderTargets.set(key, target);
    return target;
  }
  
  /**
   * Clean up old unused render targets
   */
  private cleanupUnusedTargets(): void {
    const targets = Array.from(this.renderTargets.values());
    const unusedTargets = targets
      .filter(t => t.refCount === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    
    // Keep pool size under limit
    while (unusedTargets.length > this.POOL_SIZE) {
      const target = unusedTargets.shift()!;
      this.renderTargets.delete(target.id);
      console.log(`[GpuResourceManager] Evicted unused target ${target.id}`);
    }
  }
  
  /**
   * Find the appropriate bucket size
   */
  private findBucketSize(size: number): number {
    for (const bucket of this.SIZE_BUCKETS) {
      if (size <= bucket) return bucket;
    }
    // For very large sizes, round to nearest 256
    return Math.ceil(size / 256) * 256;
  }
  
  /**
   * Get render target key
   */
  private getRenderTargetKey(width: number, height: number): string {
    return `${width}x${height}`;
  }
  
  /**
   * Acquire texture resources for a volume
   */
  async acquireTextureResource(volumeId: string): Promise<TextureResource> {
    let resource = this.textureCache.get(volumeId);
    
    if (!resource) {
      // Allocate new texture
      const atlasIndex = await this.allocateTexture(volumeId);
      resource = {
        id: `texture-${volumeId}`,
        volumeId,
        atlasIndex,
        refCount: 0
      };
      this.textureCache.set(volumeId, resource);
    }
    
    resource.refCount++;
    return resource;
  }
  
  /**
   * Release texture resources
   */
  releaseTextureResource(volumeId: string): void {
    const resource = this.textureCache.get(volumeId);
    if (resource) {
      resource.refCount--;
      if (resource.refCount <= 0) {
        // LRU cache will handle eviction
        resource.refCount = 0;
      }
    }
  }
  
  /**
   * Allocate texture in atlas
   */
  private async allocateTexture(volumeId: string): Promise<number> {
    // This would call the backend to allocate texture space
    // For now, return a mock index
    return Math.floor(Math.random() * 10);
  }
  
  /**
   * Get resource usage statistics
   */
  getStats(): {
    renderTargets: number;
    activeTargets: number;
    textures: number;
    activeTextures: number;
  } {
    const targets = Array.from(this.renderTargets.values());
    const activeTargets = targets.filter(t => t.refCount > 0).length;
    
    const textures = this.textureCache.size();
    const activeTextures = Array.from(this.textureCache.values())
      .filter(t => t.refCount > 0).length;
    
    return {
      renderTargets: targets.length,
      activeTargets,
      textures,
      activeTextures
    };
  }
  
  /**
   * Clean up all resources
   */
  async dispose(): Promise<void> {
    // Release all render targets
    this.renderTargets.clear();
    
    // Clear texture cache
    this.textureCache.clear();
    
    this.initialized = false;
  }
}

// Singleton instance
let instance: GpuResourceManager | null = null;

export function getGpuResourceManager(): GpuResourceManager {
  if (!instance) {
    instance = new GpuResourceManager();
  }
  return instance;
}