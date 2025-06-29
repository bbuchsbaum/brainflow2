/**
 * GPU Render Manager - Manages GPU rendering state and coordinates with backend
 * 
 * This manager handles the communication with the Rust backend for GPU-accelerated
 * rendering of neuroimaging data. It manages render state, layer configuration,
 * and frame rendering.
 */
import { coreApi } from '../api';
import type { ViewFrameExplicit, RenderLayer } from '../geometry/types';
import { frameToGpuVectors } from '../geometry/viewFrameExplicit';

export interface RenderRequest {
    frame: ViewFrameExplicit;
    layers: RenderLayer[];
    showCrosshair: boolean;
    crosshairWorld: [number, number, number];
}

export interface RenderResult {
    imageData: Uint8Array; // PNG binary data
    dimensions: [number, number];
    renderTimeMs: number;
}

/**
 * Manager for GPU rendering operations
 */
export class GpuRenderManager {
    private initialized = false;
    private offscreenSize: [number, number] | null = null;
    private activeLayerIndices = new Map<string, number>(); // volumeId -> layer index
    
    /**
     * Initialize the GPU render loop
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        console.log('[GpuRenderManager] Initializing render loop...');
        await coreApi.init_render_loop();
        this.initialized = true;
        console.log('[GpuRenderManager] Render loop initialized');
    }
    
    /**
     * Ensure offscreen render target exists with the specified size
     */
    async ensureOffscreenTarget(width: number, height: number): Promise<void> {
        if (!this.initialized) {
            throw new Error('GpuRenderManager not initialized. Call initialize() first.');
        }
        
        // Only recreate if size changed
        if (this.offscreenSize && 
            this.offscreenSize[0] === width && 
            this.offscreenSize[1] === height) {
            return;
        }
        
        console.log(`[GpuRenderManager] Creating offscreen target ${width}x${height}`);
        await coreApi.create_offscreen_render_target(width, height);
        this.offscreenSize = [width, height];
    }
    
    /**
     * Clear all render layers
     */
    async clearLayers(): Promise<void> {
        await coreApi.clear_render_layers();
        this.activeLayerIndices.clear();
    }
    
    /**
     * Set up layers for rendering
     * @param layers - Layers with optional atlasIndex if already uploaded
     */
    async setupLayers(layers: Array<RenderLayer & { atlasIndex?: number }>): Promise<void> {
        // Clear existing layers
        await this.clearLayers();
        
        // Add each layer
        for (const layer of layers) {
            // Use provided atlas index or default to 0
            const atlasIndex = layer.atlasIndex ?? 0;
            
            // For now, we'll use a simple texture coordinate mapping
            // In a real implementation, this would be calculated based on the volume
            const textureCoords = [0, 0, 1, 1]; // Full texture
            
            const layerIndex = await coreApi.add_render_layer(
                atlasIndex,
                layer.opacity,
                textureCoords
            );
            
            this.activeLayerIndices.set(layer.volumeId, layerIndex);
            
            // Apply layer settings
            await coreApi.update_layer_colormap(layerIndex, layer.colormapId);
            
            // Convert window/level to min/max
            const intensityMin = layer.window.level - layer.window.width / 2;
            const intensityMax = layer.window.level + layer.window.width / 2;
            await coreApi.update_layer_intensity(layerIndex, intensityMin, intensityMax);
            
            // Apply threshold if specified
            if (layer.threshold) {
                await coreApi.update_layer_threshold(
                    layerIndex,
                    layer.threshold.low,
                    layer.threshold.high
                );
            }
        }
    }
    
    /**
     * Update a single layer's properties
     */
    async updateLayer(volumeId: string, updates: Partial<RenderLayer>): Promise<void> {
        const layerIndex = this.activeLayerIndices.get(volumeId);
        if (layerIndex === undefined) {
            throw new Error(`No active layer for volume ${volumeId}`);
        }
        
        if (updates.opacity !== undefined) {
            await coreApi.update_layer_opacity(layerIndex, updates.opacity);
        }
        
        if (updates.colormapId !== undefined) {
            await coreApi.update_layer_colormap(layerIndex, updates.colormapId);
        }
        
        if (updates.window) {
            const intensityMin = updates.window.level - updates.window.width / 2;
            const intensityMax = updates.window.level + updates.window.width / 2;
            await coreApi.update_layer_intensity(layerIndex, intensityMin, intensityMax);
        }
        
        if (updates.threshold) {
            await coreApi.update_layer_threshold(
                layerIndex,
                updates.threshold.low,
                updates.threshold.high
            );
        }
    }
    
    /**
     * Render a frame with the current state
     */
    async render(request: RenderRequest): Promise<RenderResult> {
        if (!this.initialized) {
            throw new Error('GpuRenderManager not initialized. Call initialize() first.');
        }
        
        // Ensure offscreen target
        await this.ensureOffscreenTarget(
            request.frame.viewport_px.x,
            request.frame.viewport_px.y
        );
        
        // Convert frame to GPU vectors
        const { origin_mm, u_mm, v_mm } = frameToGpuVectors(request.frame);
        
        // Update frame parameters
        await coreApi.update_frame_ubo(origin_mm, u_mm, v_mm);
        
        // Set crosshair
        await coreApi.set_crosshair(request.crosshairWorld);
        
        // Render and get PNG data
        const startTime = performance.now();
        const imageData = await coreApi.render_to_image_binary();
        const renderTimeMs = performance.now() - startTime;
        
        return {
            imageData,
            dimensions: [request.frame.viewport_px.x, request.frame.viewport_px.y],
            renderTimeMs
        };
    }
    
    /**
     * Alternative render method using synchronized view
     */
    async renderSynchronizedView(
        viewWidthMm: number,
        viewHeightMm: number,
        crosshairWorld: [number, number, number],
        planeId: 0 | 1 | 2,
        viewportWidth: number,
        viewportHeight: number
    ): Promise<RenderResult> {
        if (!this.initialized) {
            throw new Error('GpuRenderManager not initialized. Call initialize() first.');
        }
        
        // Ensure offscreen target
        await this.ensureOffscreenTarget(viewportWidth, viewportHeight);
        
        // Update frame for synchronized view
        await coreApi.update_frame_for_synchronized_view(
            viewWidthMm,
            viewHeightMm,
            crosshairWorld,
            planeId
        );
        
        // Set crosshair
        await coreApi.set_crosshair(crosshairWorld);
        
        // Render and get PNG data
        const startTime = performance.now();
        const imageData = await coreApi.render_to_image_binary();
        const renderTimeMs = performance.now() - startTime;
        
        return {
            imageData,
            dimensions: [viewportWidth, viewportHeight],
            renderTimeMs
        };
    }
    
    /**
     * Add a volume layer to the render state
     */
    async addVolumeLayer(
        volumeId: string,
        atlasIndex: number,
        opacity: number = 1.0,
        colormapId: number = 0
    ): Promise<number> {
        // Add the layer
        const layerIndex = await coreApi.add_render_layer(
            atlasIndex,
            opacity,
            [0, 0, 1, 1] // Full texture coords
        );
        
        // Track it
        this.activeLayerIndices.set(volumeId, layerIndex);
        
        // Set initial colormap
        await coreApi.update_layer_colormap(layerIndex, colormapId);
        
        return layerIndex;
    }
    
    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        if (this.initialized) {
            await this.clearLayers();
            // Note: We don't have a way to fully shutdown the render loop yet
            this.initialized = false;
            this.offscreenSize = null;
        }
    }
}

// Singleton instance
let instance: GpuRenderManager | null = null;

/**
 * Get or create the GPU render manager singleton
 */
export function getGpuRenderManager(): GpuRenderManager {
    if (!instance) {
        instance = new GpuRenderManager();
    }
    return instance;
}