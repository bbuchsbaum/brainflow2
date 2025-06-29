import { invoke } from '@tauri-apps/api/core';
import { waitForTauri } from './tauri-ready';
import type {
    VolumeHandleInfo,
    VolumeLayerGpuInfo,
    LayerSpec,
    VolumeLayerSpec,
    TimeSeriesResult,
    ReleaseResult,
    FlatNode,
    TreePayload,
    GpuTextureFormat,
    LayerPatch
} from '@brainflow/api';

// Render frame command no longer needs parameters
// The frame is rendered using the current state set by other commands

// --- Helper to wrap invoke with Tauri readiness check ---
async function invokeWithReady<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await waitForTauri();
    return invoke<T>(cmd, args);
}

// --- Core API Wrapper Functions ---

/**
 * Loads a file using the appropriate backend loader.
 * @param path - Absolute path to the file.
 * @returns Handle information for the loaded volume/resource.
 */
async function load_file(path: string): Promise<VolumeHandleInfo> {
    try {
        // Ensure command name matches the #[command] name in Rust
        const result = await invokeWithReady<VolumeHandleInfo>('plugin:api-bridge|load_file', { path });
        return result;
    } catch (error) {
        console.error("API Error [load_file]:", error);
        // Re-throw or handle specific errors based on structure
        throw error; // TODO: Map to a structured error object?
    }
}

/**
 * Converts a world coordinate to a voxel coordinate for a specific volume.
 * @param volume_id - ID of the target volume.
 * @param world_coord - [x, y, z] world coordinates.
 * @returns Voxel coordinates [i, j, k] or null if outside bounds.
 */
async function world_to_voxel(volume_id: string, world_coord: [number, number, number]): Promise<[number, number, number] | null> {
    try {
        const result = await invokeWithReady<[number, number, number] | null>('plugin:api-bridge|world_to_voxel', { 
            volumeId: volume_id, 
            worldCoord: world_coord 
        });
        return result;
    } catch (error) {
        console.error("API Error [world_to_voxel]:", error);
        throw error;
    }
}

/**
 * Retrieves time series data for a set of world coordinates.
 * @param volume_id - ID of the target volume.
 * @param coords - Array of [x, y, z] world coordinates.
 * @returns Time series matrix and coordinate count.
 */
async function get_timeseries_matrix(volume_id: string, coords: [number, number, number][]): Promise<TimeSeriesResult> {
    try {
        const result = await invokeWithReady<TimeSeriesResult>('plugin:api-bridge|get_timeseries_matrix', { 
            volumeId: volume_id, 
            coords: coords 
        });
        return result;
    } catch (error) {
        console.error("API Error [get_timeseries_matrix]:", error);
        throw error;
    }
}

/**
 * Requests GPU resources for a specific layer configuration.
 * @param layer_spec - Specification for the layer to be rendered.
 * @returns Information about the allocated GPU resources.
 */
async function request_layer_gpu_resources(layer_spec: LayerSpec): Promise<VolumeLayerGpuInfo> {
    try {
        console.log('[API] Calling request_layer_gpu_resources with:', layer_spec);
        // Note: Tauri expects camelCase parameter names
        const result = await invokeWithReady<VolumeLayerGpuInfo>('plugin:api-bridge|request_layer_gpu_resources', { 
            layerSpec: layer_spec 
        });
        console.log('[API] request_layer_gpu_resources result:', result);
        return result;
    } catch (error) {
        console.error("API Error [request_layer_gpu_resources]:", error);
        console.error("Error details:", JSON.stringify(error, null, 2));
        throw error;
    }
}

/**
 * Releases GPU resources associated with a specific view or component ID.
 * @param resource_id - The ID used to track the resources (e.g., component ID, layer ID).
 * @returns Result indicating success or failure.
 */
async function release_view_resources(resource_id: string): Promise<ReleaseResult> {
    try {
        const result = await invokeWithReady<ReleaseResult>('plugin:api-bridge|release_layer_gpu_resources', { layerId: resource_id });
        return result;
    } catch (error) {
        console.error("API Error [release_view_resources]:", error);
        throw error;
    }
}

/**
 * Checks if the system supports WebGPU.
 * @returns True if WebGPU is likely supported, false otherwise.
 */
async function supports_webgpu(): Promise<boolean> {
    try {
        const result = await invokeWithReady<boolean>('plugin:api-bridge|supports_webgpu');
        return result;
    } catch (error) {
        console.error("API Error [supports_webgpu]:", error);
        // Assume false on error?
        return false;
    }
}

/**
 * Resizes the GPU surface associated with a specific window.
 * NOTE: This command needs to be implemented in Rust.
 * @param window_label - The label of the Tauri window.
 * @param width - The new width in physical pixels.
 * @param height - The new height in physical pixels.
 */
async function resize_gpu_surface(window_label: string, width: number, height: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|resize_canvas', { width, height });
    } catch (error) {
        console.error("API Error [resize_gpu_surface]:", error);
        throw error;
    }
}

/**
 * Sets the world coordinates for the crosshair.
 * @param coords - [x, y, z] world coordinates.
 */
async function set_crosshair(coords: [number, number, number]): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|set_crosshair', { worldCoords: coords });
    } catch (error) {
        console.error("API Error [set_crosshair]:", error);
        throw error;
    }
}

/**
 * Sets the current view plane.
 * @param plane_id - 0=Axial, 1=Coronal, 2=Sagittal.
 */
async function set_view_plane(plane_id: 0 | 1 | 2): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|set_view_plane', { planeId: plane_id });
    } catch (error) {
        console.error("API Error [set_view_plane]:", error);
        throw error;
    }
}

/**
 * Initializes the render loop service for GPU rendering.
 */
async function init_render_loop(): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|init_render_loop', {});
    } catch (error) {
        console.error("API Error [init_render_loop]:", error);
        throw error;
    }
}

/**
 * Resizes the rendering canvas/surface.
 * @param width - New width in pixels.
 * @param height - New height in pixels.
 */
async function resize_canvas(width: number, height: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|resize_canvas', { width, height });
    } catch (error) {
        console.error("API Error [resize_canvas]:", error);
        throw error;
    }
}

/**
 * Updates the frame uniform buffer object with rendering parameters.
 * @param origin_mm - 4-element array for plane center in world mm.
 * @param u_mm - 4-element array for world vector for clip space +X.
 * @param v_mm - 4-element array for world vector for clip space +Y.
 */
async function update_frame_ubo(
    origin_mm: number[],
    u_mm: number[],
    v_mm: number[]
): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_frame_ubo', { 
            originMm: origin_mm,
            uMm: u_mm,
            vMm: v_mm
        });
    } catch (error) {
        console.error("API Error [update_frame_ubo]:", error);
        throw error;
    }
}

/**
 * Sets the parameters for the Frame UBO (origin and basis vectors).
 * @param origin - [x, y, z, w=1] world coordinates for plane center.
 * @param u_basis - [x, y, z, w=0] world vector for clip +X.
 * @param v_basis - [x, y, z, w=0] world vector for clip +Y.
 */
async function set_frame_params(origin: [number, number, number, number], u_basis: [number, number, number, number], v_basis: [number, number, number, number]): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|set_frame_params', { origin, uBasis: u_basis, vBasis: v_basis });
    } catch (error) {
        console.error("API Error [set_frame_params]:", error);
        throw error;
    }
}

/**
 * Triggers a render frame using the current render state.
 */
async function render_frame(): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|render_frame');
    } catch (error) {
        console.error("API Error [render_frame]:", error);
        throw error;
    }
}

/**
 * Updates frame parameters for synchronized orthogonal views.
 * Simplifies view setup by handling frame parameter calculations on the backend.
 * @param view_width_mm - Width of the view in millimeters.
 * @param view_height_mm - Height of the view in millimeters.
 * @param crosshair_world - World coordinates [x, y, z] of the crosshair.
 * @param plane_id - View plane ID (0=Axial, 1=Coronal, 2=Sagittal).
 */
async function update_frame_for_synchronized_view(
    view_width_mm: number,
    view_height_mm: number,
    crosshair_world: [number, number, number],
    plane_id: 0 | 1 | 2
): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_frame_for_synchronized_view', {
            viewWidthMm: view_width_mm,
            viewHeightMm: view_height_mm,
            crosshairWorld: crosshair_world,
            planeId: plane_id
        });
    } catch (error) {
        console.error("API Error [update_frame_for_synchronized_view]:", error);
        throw error;
    }
}

// --- NEW Function: fs_list_directory ---

/**
 * Lists the contents of a directory, filtered for loadable files and directories.
 * @param dir - The absolute path of the directory to list.
 * @returns A TreePayload containing a flat list of nodes.
 */
async function fs_list_directory(dir: string): Promise<TreePayload> {
    try {
        // Command name matches the Rust command
        const result = await invokeWithReady<TreePayload>('plugin:api-bridge|fs_list_directory', { path: dir });
        return result;
    } catch (error) {
        console.error("API Error [fs_list_directory]:", error);
        // Re-throw or handle specific errors based on BridgeError structure
        // Example: Check if error has shape { code: number, details: string }
        throw error; 
    }
}

/**
 * Creates an offscreen render target for GPU rendering.
 * @param width - Width of the render target in pixels.
 * @param height - Height of the render target in pixels.
 */
async function create_offscreen_render_target(width: number, height: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|create_offscreen_render_target', { width, height });
    } catch (error) {
        console.error("API Error [create_offscreen_render_target]:", error);
        throw error;
    }
}

/**
 * Renders the current frame to an offscreen buffer and returns it as a base64-encoded image.
 * @returns Base64-encoded image data URL (format: "data:image/raw-rgba;base64,...").
 */
async function render_to_image(): Promise<string> {
    try {
        const result = await invokeWithReady<string>('plugin:api-bridge|render_to_image', {});
        return result;
    } catch (error) {
        console.error("API Error [render_to_image]:", error);
        throw error;
    }
}

/**
 * Adds a layer to the render state for GPU rendering.
 * @param atlas_index - Index of the texture in the atlas.
 * @param opacity - Layer opacity (0.0 to 1.0).
 * @param texture_coords - Texture coordinates [u_min, v_min, u_max, v_max].
 * @returns The index of the added layer.
 */
async function add_render_layer(atlas_index: number, opacity: number, texture_coords: number[]): Promise<number> {
    try {
        const result = await invokeWithReady<number>('plugin:api-bridge|add_render_layer', { 
            atlasIndex: atlas_index,
            opacity: opacity,
            textureCoords: texture_coords
        });
        return result;
    } catch (error) {
        console.error("API Error [add_render_layer]:", error);
        throw error;
    }
}

/**
 * Updates layer properties with a patch object.
 * @param layerId - The ID of the layer to update
 * @param patch - The properties to update (only non-null values will be applied)
 * @returns A promise that resolves when the update is complete
 */
async function patch_layer(layerId: string, patch: LayerPatch): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|patch_layer', {
            layerId: layerId,
            patch: patch
        });
    } catch (error) {
        console.error("API Error [patch_layer]:", error);
        throw error;
    }
}

/**
 * Samples the intensity value at a world coordinate.
 * @param handle_id - Volume handle ID.
 * @param world_coords - [x, y, z] world coordinates.
 * @returns The intensity value at that location.
 */
async function sample_world_coordinate(handle_id: string, world_coords: [number, number, number]): Promise<number> {
    try {
        const result = await invokeWithReady<number>('plugin:api-bridge|sample_world_coordinate', {
            handleId: handle_id,
            worldCoords: world_coords
        });
        return result;
    } catch (error) {
        console.error("API Error [sample_world_coordinate]:", error);
        throw error;
    }
}

/**
 * Clears all render layers from the GPU render state.
 */
async function clear_render_layers(): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|clear_render_layers', {});
    } catch (error) {
        console.error("API Error [clear_render_layers]:", error);
        throw error;
    }
}

/**
 * Updates the opacity of a specific render layer.
 * @param layer_index - Index of the layer to update.
 * @param opacity - New opacity value (0.0 to 1.0).
 */
async function update_layer_opacity(layer_index: number, opacity: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_layer_opacity', {
            layerIndex: layer_index,
            opacity: opacity
        });
    } catch (error) {
        console.error("API Error [update_layer_opacity]:", error);
        throw error;
    }
}

/**
 * Updates the colormap of a specific render layer.
 * @param layer_index - Index of the layer to update.
 * @param colormap_id - ID of the new colormap to use.
 */
async function update_layer_colormap(layer_index: number, colormap_id: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_layer_colormap', {
            layerIndex: layer_index,
            colormapId: colormap_id
        });
    } catch (error) {
        console.error("API Error [update_layer_colormap]:", error);
        throw error;
    }
}

/**
 * Updates the intensity window of a specific render layer.
 * @param layer_index - Index of the layer to update.
 * @param intensity_min - Minimum intensity value.
 * @param intensity_max - Maximum intensity value.
 */
async function update_layer_intensity(layer_index: number, intensity_min: number, intensity_max: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_layer_intensity', {
            layerIndex: layer_index,
            intensityMin: intensity_min,
            intensityMax: intensity_max
        });
    } catch (error) {
        console.error("API Error [update_layer_intensity]:", error);
        throw error;
    }
}

/**
 * Updates the threshold range of a specific render layer.
 * @param layer_index - Index of the layer to update.
 * @param threshold_low - Lower threshold value.
 * @param threshold_high - Upper threshold value.
 */
async function update_layer_threshold(layer_index: number, threshold_low: number, threshold_high: number): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|update_layer_threshold', {
            layerIndex: layer_index,
            thresholdLow: threshold_low,
            thresholdHigh: threshold_high
        });
    } catch (error) {
        console.error("API Error [update_layer_threshold]:", error);
        throw error;
    }
}

/**
 * Sets whether a layer should be treated as a mask.
 * @param layer_index - Index of the layer to update.
 * @param is_mask - Whether the layer should be treated as a mask.
 */
async function set_layer_mask(layer_index: number, is_mask: boolean): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|set_layer_mask', {
            layerIndex: layer_index,
            isMask: is_mask
        });
    } catch (error) {
        console.error("API Error [set_layer_mask]:", error);
        throw error;
    }
}

/**
 * Sets up rendering parameters for a specific view frame.
 * @param origin_mm - Origin point in world space (mm).
 * @param u_dir - Unit vector for view's X-axis direction.
 * @param v_dir - Unit vector for view's Y-axis direction.
 * @param pixels_per_mm - Scale factor: pixels per millimeter.
 * @param viewport_width - Width of viewport in pixels.
 * @param viewport_height - Height of viewport in pixels.
 */
async function request_frame(
    origin_mm: [number, number, number],
    u_dir: [number, number, number],
    v_dir: [number, number, number],
    pixels_per_mm: number,
    viewport_width: number,
    viewport_height: number
): Promise<void> {
    try {
        await invokeWithReady<void>('plugin:api-bridge|request_frame', {
            originMm: origin_mm,
            uDir: u_dir,
            vDir: v_dir,
            pixelsPerMm: pixels_per_mm,
            viewportWidth: viewport_width,
            viewportHeight: viewport_height
        });
    } catch (error) {
        console.error("API Error [request_frame]:", error);
        throw error;
    }
}

/**
 * Renders the current frame to an offscreen buffer and returns it as PNG binary data.
 * @returns PNG-encoded image data as Uint8Array.
 */
async function render_to_image_binary(): Promise<Uint8Array> {
    try {
        const result = await invokeWithReady<number[]>('plugin:api-bridge|render_to_image_binary', {});
        // Convert from number[] to Uint8Array
        return new Uint8Array(result);
    } catch (error) {
        console.error("API Error [render_to_image_binary]:", error);
        throw error;
    }
}

// --- Export the API object ---

// Functions already defined above

const baseApi = {
    load_file,
    world_to_voxel,
    get_timeseries_matrix,
    request_layer_gpu_resources,
    release_view_resources,
    supports_webgpu,
    resize_canvas,
    set_crosshair,
    set_view_plane,
    init_render_loop,
    update_frame_ubo,
    update_frame_for_synchronized_view,
    render_frame,
    fs_list_directory,
    create_offscreen_render_target,
    render_to_image,
    add_render_layer,
    patch_layer,
    sample_world_coordinate,
    clear_render_layers,
    update_layer_opacity,
    update_layer_colormap,
    update_layer_intensity,
    update_layer_threshold,
    set_layer_mask,
    request_frame,
    render_to_image_binary,
};

// Export the API with optional logging wrapper
// To enable logging, import wrapApiWithLogging from bridgeLogger
export const coreApi = baseApi;

// Also export baseApi for direct access without logging
export { baseApi };

// Re-export types that components need
export type {
    VolumeHandleInfo,
    VolumeLayerGpuInfo,
    LayerSpec,
    VolumeLayerSpec,
    TimeSeriesResult,
    ReleaseResult,
    FlatNode,
    TreePayload,
    GpuTextureFormat,
    LayerPatch
} from '@brainflow/api'; 