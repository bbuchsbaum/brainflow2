/**
 * @brainflow/api v0.1.1 - Core TypeScript Interfaces
 */

// Import and re-export generated types
export * from './generated';

// Import specific types we need to reference
import type { 
    VolumeHandleInfo, 
    VolumeLayerGpuInfo, 
    BridgeError,
    TimeSeriesResult,
    LayerSpec,
    ReleaseResult 
} from './generated';

/**
 * Generic Result type for Tauri commands, mirroring Rust's Result.
 */
export type Result<T, E = string> = { Ok: T; Err?: never } | { Ok?: never; Err: E };

export interface CoreApi {
    // File operations
    // Loads a file (NIfTI, GIfTI, potentially others via plugins)
    // Returns a handle representing the loaded resource.
    load_file(path: string): Promise<VolumeHandleInfo>;

    // Coordinate transformations
    // Converts world coordinates (mm) to voxel indices for a given volume.
    world_to_voxel(volumeId: string, worldCoord: [number, number, number]): Promise<[number, number, number] | null>;

    // Data extraction
    // Extracts time-series data for a set of world coordinates from a volume.
    // Can return a simple Float32Array (1xT) or a more structured DataFrame (NxK).
    get_timeseries_matrix(volumeId: string, coords: Array<[number, number, number]>): Promise<TimeSeriesResult>;

    // GPU resource management
    // Requests the allocation and upload of GPU resources (textures, buffers) for a specific layer.
    request_layer_gpu_resources(
        layerSpec: LayerSpec
    ): Promise<Result<VolumeLayerGpuInfo, BridgeError>>;

    // Resource release
    release_layer_gpu_resources(layerId: string): Promise<ReleaseResult>;
    
    // Check WebGPU Support
    supports_webgpu(): Promise<boolean>;

    // Crosshair and View Plane Updates
    set_crosshair(world_coords: [number, number, number]): Promise<void>;
    set_view_plane(plane_id: 0 | 1 | 2): Promise<void>; // 0=Ax, 1=Cor, 2=Sag

    // Render Loop Management
    init_render_loop(canvas_id: string): Promise<void>;
    resize_canvas(width: number, height: number): Promise<void>;
    update_frame_ubo(
        view_proj: number[],          // 16 elements for 4x4 matrix
        world_to_voxel: number[],     // 16 elements for 4x4 matrix
        crosshair_voxel: number[],    // 4 elements
        view_plane_normal: number[],  // 4 elements
        view_plane_distance: number
    ): Promise<void>;
    render_frame(): Promise<void>;
}

// --- Data Model Handles & Specs ---

// Note: VolumeHandleInfo is now imported from generated types
// These handle types extend the generated info with a type discriminator
export type VolumeHandle = VolumeHandleInfo & { type: 'volume' };
export type SurfaceHandle = { type: 'surface'; id: string; name: string; /* other metadata */ };
export type AtlasLayerHandle = { type: 'atlas'; id: string; name: string; /* other metadata */ };

// Note: LayerSpec types are now imported from generated types
// The generated VolumeLayerSpec includes all necessary fields

// Note: LayerGpuResources is now imported from generated types

// --- Data Structures ---

// Represents numeric types potentially used in DataFrames or buffers
export type NumericType = 'float32' | 'int32' | 'uint32' | 'int16' | 'uint16' | 'int8' | 'uint8';

// Opaque handle for shared buffers (likely SharedArrayBuffer underneath)
export type DataBuffer = ArrayBuffer | SharedArrayBuffer; 

// Structured 2D data, often used for time-series or tabular results
export interface DataFrame {
    shape: [number, number]; // [rows, columns]
    columns: string[]; // Names of the columns
    buffer: DataBuffer; // Underlying data buffer (row-major or column-major TBD)
    colDtype: NumericType[]; // Data type for each column
    // Potentially add row labels/index later
}

// Generic container for data passed to plugins (e.g., PlotWorker)
export interface DataSample {
    type: "timeseries" | "dataframe" | string; // Extensible type identifier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: DataFrame | Float32Array | any; // The actual data payload
    metadata?: Record<string, unknown>; // Optional additional context
}

// --- Plugin Interfaces (Conceptual for now, details in PLUGIN-guide-v0.1.md) ---

// Interface for loader plugins
export interface LoaderPlugin {
    manifest: PluginManifest;
    load(filePath: string, coreApi: CoreApi): Promise<VolumeHandle | SurfaceHandle | AtlasLayerHandle>;
}

// Interface for plot plugins
export interface PlotPlugin {
    manifest: PluginManifest;
    render(targetElement: HTMLElement | OffscreenCanvas, data: DataSample, options?: Record<string, unknown>): Promise<void>;
    resize?(width: number, height: number): Promise<void>;
    dispose?(): Promise<void>;
}

// Manifest structure for plugins (defined in SPEC-json-schemas-v0.1.1.md)
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    compatibleCore: string; // SemVer range for compatible CoreApi
    type: 'loader' | 'plot' | string;
    apiVersion: string; // Version of the @brainflow/api this plugin targets
    entrypoint: string; // Path to the plugin's main JS file
    description?: string;
    author?: string;
    handles?: string[] | Record<string, unknown>; // File extensions (loader) or data types (plot)
}

// Note: Error types are replaced by BridgeError from generated types

// Note: VolumeSendable is not exposed to TypeScript as it contains raw volume data
// Instead, we use VolumeHandleInfo which contains the metadata needed by the frontend

// Note: VolumeLayerGPU is replaced by VolumeLayerGpuInfo from generated types

 