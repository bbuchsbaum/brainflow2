/**
 * ResourceMonitor
 * 
 * Tracks ImageBitmap allocations to prevent GPU resource exhaustion.
 * Provides allocation limits, cleanup triggers, and usage monitoring.
 */

export class ResourceMonitor {
  private static instance: ResourceMonitor | null = null;
  private allocatedBitmaps = 0;
  // Increased limits to support MosaicView (16 cells) plus other views
  private readonly MAX_BITMAPS = 32; // Support mosaic + slice views
  private readonly CLEANUP_THRESHOLD = 24; // Trigger cleanup at 75% capacity
  
  /**
   * Get singleton instance
   */
  static getInstance(): ResourceMonitor {
    if (!ResourceMonitor.instance) {
      ResourceMonitor.instance = new ResourceMonitor();
    }
    return ResourceMonitor.instance;
  }
  
  /**
   * Attempt to allocate a new ImageBitmap slot
   * @returns true if allocation succeeded, false if at limit
   */
  allocate(): boolean {
    if (this.allocatedBitmaps >= this.MAX_BITMAPS) {
      console.warn(`[ResourceMonitor] Max bitmaps (${this.MAX_BITMAPS}) reached, rejecting allocation`);
      return false;
    }
    
    this.allocatedBitmaps++;
    console.debug(`[ResourceMonitor] Bitmap allocated (${this.allocatedBitmaps}/${this.MAX_BITMAPS})`);
    
    if (this.allocatedBitmaps >= this.CLEANUP_THRESHOLD) {
      this.requestCleanup();
    }
    
    return true;
  }
  
  /**
   * Deallocate an ImageBitmap slot
   */
  deallocate(): void {
    if (this.allocatedBitmaps > 0) {
      this.allocatedBitmaps--;
      console.debug(`[ResourceMonitor] Bitmap deallocated (${this.allocatedBitmaps}/${this.MAX_BITMAPS})`);
    }
  }
  
  /**
   * Request garbage collection if available
   */
  private requestCleanup(): void {
    console.log('[ResourceMonitor] Requesting garbage collection');
    // In Chrome, you can expose gc() with --expose-gc flag
    if (typeof window !== 'undefined' && 'gc' in window) {
      (window as any).gc();
    }
  }
  
  /**
   * Get current resource status
   */
  getStatus() {
    return {
      allocated: this.allocatedBitmaps,
      max: this.MAX_BITMAPS,
      available: this.MAX_BITMAPS - this.allocatedBitmaps,
      utilizationPercent: (this.allocatedBitmaps / this.MAX_BITMAPS) * 100
    };
  }
  
  /**
   * Reset the resource monitor (for testing/development)
   */
  reset(): void {
    this.allocatedBitmaps = 0;
    console.log('[ResourceMonitor] Reset allocation counter');
  }
}